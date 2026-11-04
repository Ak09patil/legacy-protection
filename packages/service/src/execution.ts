/**
 * Running an activated plan. Steps come only from the confirmed plan version
 * (INV-02) and every step goes through the policy gate before it reaches
 * PayPal: the same gate the AI agent's tool calls go through.
 */

import { money, moneyActionKey, type Phase } from "@lp/core";
import { appendEvent } from "@lp/db/audit";
import { authorize, type PlannedStep, type ToolCall } from "@lp/guard";
import { cancelInvoice, cancelSubscription, payCaregiver, type PayPalClient } from "@lp/paypal";
import { planExecution, type ExecutionStep } from "@lp/policy";
import type pg from "pg";
import { openJson, sealJson } from "@lp/vault";
import { applyEvent, type StateRow } from "./lifecycle.js";
import { confirmedPlan, inTx } from "./timeline.js";
import { serviceVault } from "./vault.js";

/** Where steps actually happen. PayPal in production and sandbox; a dry run when no keys are configured. */
export interface Executor {
  readonly name: string;
  accountSnapshot(): Promise<{ activeSubscriptionIds: string[]; openInvoiceIds: string[] }>;
  run(step: ExecutionStep, ctx: { planVersionId: string; requestId: string }): Promise<{ reference: string }>;
}

export class PayPalExecutor implements Executor {
  readonly name = "paypal-sandbox";
  constructor(private readonly client: PayPalClient) {}

  async accountSnapshot() {
    // Invoices this account sent that are still unpaid. PayPal's public API has no way for a
    // consumer's own recurring payments to be listed; that is one of the PayPal-side endpoints
    // this design asks for (docs/WHAT_PAYPAL_NEEDS.md).
    const r = await this.client.request<{ items?: Array<{ id: string; status: string }> }>({
      method: "GET",
      path: "/v2/invoicing/invoices",
      query: { page: 1, page_size: 100 },
    });
    const openInvoiceIds = (r.items ?? []).filter((i) => ["SENT", "UNPAID", "PARTIALLY_PAID"].includes(i.status)).map((i) => i.id);
    return { activeSubscriptionIds: [], openInvoiceIds };
  }

  async run(step: ExecutionStep, ctx: { planVersionId: string; requestId: string }) {
    switch (step.type) {
      case "CANCEL_INVOICE":
        await cancelInvoice(this.client, { planVersionId: ctx.planVersionId, stepId: step.id, invoiceId: step.invoiceId, note: "Cancelled under the account owner’s Legacy Protection plan." });
        return { reference: step.invoiceId };
      case "CANCEL_SUBSCRIPTION":
        await cancelSubscription(this.client, { planVersionId: ctx.planVersionId, stepId: step.id, subscriptionId: step.subscriptionId, reason: "Account owner’s Legacy Protection plan" });
        return { reference: step.subscriptionId };
      case "PAY_OBLIGATION": {
        const r = await payCaregiver(this.client, {
          planVersionId: ctx.planVersionId,
          stepId: step.id,
          receiverEmail: step.payeeEmail,
          amount: money(BigInt(step.amountMinor), step.currency),
          note: "Care payment from a Legacy Protection plan.",
        });
        return { reference: r.batch_header.payout_batch_id };
      }
      case "ASSEMBLE_EXECUTOR_PACKAGE":
        return { reference: "executor-package" };
    }
  }
}

/** For local development without PayPal keys: records each step as not sent, and says so. */
export class DryRunExecutor implements Executor {
  readonly name = "dry-run";
  async accountSnapshot() {
    return { activeSubscriptionIds: [], openInvoiceIds: [] };
  }
  async run(step: ExecutionStep) {
    return { reference: `dry-run:${step.id}` };
  }
}

/** Readable in the database without the vault, so it names no people (INV-24). */
function label(step: ExecutionStep): string {
  switch (step.type) {
    case "CANCEL_SUBSCRIPTION":
      return "Stop a recurring payment";
    case "CANCEL_INVOICE":
      return "Cancel an unpaid invoice";
    case "PAY_OBLIGATION":
      return "Care payment";
    case "ASSEMBLE_EXECUTOR_PACKAGE":
      return "Prepare the executor’s record";
  }
}

/** The tool call that corresponds to a plan step, so steps and AI tool calls pass the same gate. */
export function toolCallFor(step: ExecutionStep): ToolCall | null {
  switch (step.type) {
    case "CANCEL_SUBSCRIPTION":
      return { name: "cancel_subscription", args: { subscription_id: step.subscriptionId } };
    case "CANCEL_INVOICE":
      return { name: "cancel_sent_invoice", args: { invoice_id: step.invoiceId } };
    case "PAY_OBLIGATION":
      return { name: "pay_planned_obligation", args: { step_id: step.id } };
    case "ASSEMBLE_EXECUTOR_PACKAGE":
      return null;
  }
}

/** ACTIVATED → EXECUTING, and records the exact steps the confirmed plan allows. Safe to call twice. */
export async function startExecution(pool: pg.Pool, planId: string, executor: Executor, now = Date.now()): Promise<boolean> {
  const snap = await executor.accountSnapshot();
  return inTx(pool, async (c) => {
    const s = await c.query<StateRow>(`SELECT * FROM plan_state WHERE plan_id = $1 FOR UPDATE`, [planId]);
    const row = s.rows[0];
    if (!row || !row.plan_version_id) return false;
    if (row.phase === "EXECUTING") return true;
    if (row.phase !== "ACTIVATED") return false;
    const plan = await confirmedPlan(c, row.plan_version_id);
    if (!plan) return false;
    const steps = planExecution(plan, snap, now);
    for (const st of steps) {
      const stored = await sealJson(serviceVault(), planId, "plan_document", st, "run_plan");
      await c.query(
        `INSERT INTO execution_steps (id, plan_id, plan_version_id, step, label, due_at, status, paypal_request_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'SCHEDULED', $7) ON CONFLICT DO NOTHING`,
        [st.id, planId, row.plan_version_id, JSON.stringify(stored), label(st), new Date(st.type === "PAY_OBLIGATION" ? st.dueAt : now), moneyActionKey(row.plan_version_id, st.id)],
      );
    }
    await applyEvent(c, planId, { type: "EXECUTION_STARTED", at: now }, "executor", { steps: steps.length, executor: executor.name });
    await appendEvent(c, { planId, at: new Date(now), kind: "BALANCE_HELD", actor: "executor", payload: { note: "Remaining balance held for the estate. No step can send it anywhere (INV-04)." } });
    return true;
  });
}

export async function pendingSteps(pool: pg.Pool, planId: string): Promise<Array<{ id: string; dueAt: number }>> {
  const r = await pool.query<{ id: string; due_at: Date }>(
    `SELECT id, due_at FROM execution_steps WHERE plan_id = $1 AND status IN ('SCHEDULED', 'RUNNING', 'FAILED') ORDER BY due_at, id`,
    [planId],
  );
  return r.rows.map((x) => ({ id: x.id, dueAt: x.due_at.getTime() }));
}

/**
 * Runs one step through the gate. Retrying is safe: the gate refuses a done
 * step, and PayPal refuses a repeated request id (INV-03).
 */
export async function runStep(pool: pg.Pool, planId: string, stepId: string, executor: Executor, now = Date.now()): Promise<{ outcome: "DONE" | "REFUSED" | "SKIPPED"; detail?: string }> {
  const [state, rows] = await Promise.all([
    pool.query<{ phase: Phase; plan_version_id: string | null }>(`SELECT phase, plan_version_id FROM plan_state WHERE plan_id = $1`, [planId]),
    pool.query<{ id: string; step: unknown; status: string }>(`SELECT id, step, status FROM execution_steps WHERE plan_id = $1`, [planId]),
  ]);
  const opened = await Promise.all(
    rows.rows.map(async (r) => ({ id: r.id, status: r.status, step: (await openJson(serviceVault(), planId, "plan_document", r.step, "run_plan")) as ExecutionStep })),
  );
  const st = state.rows[0];
  const target = opened.find((r) => r.id === stepId);
  if (!st || !target || target.status === "DONE" || target.status === "SKIPPED") return { outcome: "SKIPPED" };
  const planned: PlannedStep[] = opened.map((r) => ({ step: r.step, done: r.status === "DONE" }));

  let requestId = "";
  const call = toolCallFor(target.step);
  if (call) {
    const v = authorize(call, { mode: "executor", phase: st.phase, planVersionId: st.plan_version_id, steps: planned, now });
    if (!v.allow) {
      // Not yet due: leave it scheduled. Anything else the gate refuses will never run.
      if (v.code !== "NOT_DUE") {
        await inTx(pool, async (c) => {
          await c.query(`UPDATE execution_steps SET status = 'SKIPPED', result = $3 WHERE plan_id = $1 AND id = $2`, [planId, stepId, JSON.stringify({ refusedBy: "guard", code: v.code })]);
          await appendEvent(c, { planId, at: new Date(now), kind: "STEP_REFUSED_BY_GATE", actor: "guard", payload: { stepId, code: v.code } });
        });
      }
      return { outcome: "REFUSED", detail: v.code };
    }
    if (v.kind === "write") requestId = v.requestId;
  }

  await pool.query(`UPDATE execution_steps SET status = 'RUNNING' WHERE plan_id = $1 AND id = $2 AND status <> 'DONE'`, [planId, stepId]);
  let result: { reference: string };
  try {
    result = await executor.run(target.step, { planVersionId: st.plan_version_id!, requestId });
  } catch (e) {
    await pool.query(`UPDATE execution_steps SET status = 'FAILED', result = $3 WHERE plan_id = $1 AND id = $2`, [planId, stepId, JSON.stringify({ error: e instanceof Error ? e.message.slice(0, 200) : "error" })]);
    throw e; // Temporal retries with the same request id
  }
  await inTx(pool, async (c) => {
    await c.query(`UPDATE execution_steps SET status = 'DONE', done_at = $3, result = $4 WHERE plan_id = $1 AND id = $2`, [planId, stepId, new Date(now), JSON.stringify({ ...result, executor: executor.name })]);
    await appendEvent(c, { planId, at: new Date(now), kind: "STEP_DONE", actor: "executor", payload: { stepId, type: target.step.type, reference: result.reference, executor: executor.name } });
  });
  return { outcome: "DONE" };
}

export async function completeIfAllDone(pool: pg.Pool, planId: string, now = Date.now()): Promise<boolean> {
  const left = await pool.query(`SELECT 1 FROM execution_steps WHERE plan_id = $1 AND status NOT IN ('DONE', 'SKIPPED') LIMIT 1`, [planId]);
  if (left.rowCount) return false;
  return inTx(pool, async (c) => !(await applyEvent(c, planId, { type: "EXECUTION_COMPLETED", at: now }, "executor")).rejected);
}
