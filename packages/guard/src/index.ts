/**
 * @lp/guard — a policy gate for PayPal's Agent Toolkit.
 *
 * PayPal's Agent Toolkit gives an AI agent tools that move money. This gate
 * decides whether a given call may run. The agent proposes; the owner's
 * confirmed plan decides.
 *
 *   1. Allowlist. Tools not listed here are never shown to the model and are
 *      refused if called anyway (refunds, captures, new orders, sending
 *      invoices...).
 *   2. Read tools run in any mode.
 *   3. Write tools run only in "executor" mode, only while the plan is
 *      executing, and only when they match a step the confirmed plan
 *      generated and that hasn't run yet (INV-01, INV-02).
 *   4. Money amounts and payees are never taken from the model. A payout
 *      call names a plan step; the gate fills in payee and amount from that
 *      step (INV-04).
 *   5. Every allowed write carries an idempotency key derived from the plan
 *      version and step, so a retried or repeated call can't move money twice
 *      (INV-03).
 */

import { moneyActionKey, type Phase } from "@lp/core";
import type { ExecutionStep } from "@lp/policy";
import { z } from "zod";

export type GuardMode = "advisor" | "executor";

/** Read-only tools from PayPal's Agent Toolkit that the agent may use. */
export const READ_TOOLS = [
  "list_transactions",
  "list_invoices",
  "get_invoice",
  "search_invoicing",
  "show_subscription_details",
  "list_disputes",
  "get_dispute",
] as const;

/** Tools that change something. Two come from PayPal's toolkit; payouts are ours (the toolkit has none). */
export const WRITE_TOOLS = ["cancel_subscription", "cancel_sent_invoice", "pay_planned_obligation"] as const;

export type ReadTool = (typeof READ_TOOLS)[number];
export type WriteTool = (typeof WRITE_TOOLS)[number];

const id = z.string().regex(/^[A-Za-z0-9_-]{1,127}$/);
const WRITE_ARGS = {
  cancel_subscription: z.object({ subscription_id: id, payload: z.object({ reason: z.string().max(128) }).passthrough().optional() }).strict(),
  cancel_sent_invoice: z.object({ invoice_id: id, note: z.string().max(500).optional() }).passthrough(),
  pay_planned_obligation: z.object({ step_id: z.string().regex(/^pay:[a-z0-9-]{1,40}:\d{1,4}$/) }).strict(),
} satisfies Record<WriteTool, z.ZodTypeAny>;

/** Definition for our payout tool, in the same function-calling shape as the toolkit's tools. */
export const PAY_PLANNED_OBLIGATION_TOOL = {
  type: "function" as const,
  function: {
    name: "pay_planned_obligation",
    description:
      "Pay one scheduled care payment from the owner's confirmed plan. Name the plan step only; the payee and amount come from the plan and cannot be changed.",
    parameters: {
      type: "object",
      properties: { step_id: { type: "string", description: "The plan step id, e.g. pay:maria-care:0" } },
      required: ["step_id"],
      additionalProperties: false,
    },
  },
};

export interface PlannedStep {
  readonly step: ExecutionStep;
  readonly done: boolean;
}

export interface Authority {
  readonly mode: GuardMode;
  readonly phase: Phase;
  readonly planVersionId: string | null;
  readonly steps: readonly PlannedStep[];
  readonly now: number;
}

export interface ToolCall {
  readonly name: string;
  readonly args: unknown;
}

export type Verdict =
  | { readonly allow: true; readonly kind: "read"; readonly tool: ReadTool }
  | {
      readonly allow: true;
      readonly kind: "write";
      readonly tool: WriteTool;
      readonly step: ExecutionStep;
      /** PayPal-Request-Id for this exact plan step. */
      readonly requestId: string;
    }
  | { readonly allow: false; readonly code: DenyCode; readonly reason: string };

export type DenyCode =
  | "NOT_ALLOWLISTED"
  | "READ_ONLY_MODE"
  | "PLAN_NOT_EXECUTING"
  | "BAD_ARGUMENTS"
  | "NOT_IN_PLAN"
  | "ALREADY_DONE"
  | "NOT_DUE";

const deny = (code: DenyCode, reason: string): Verdict => ({ allow: false, code, reason });

export function isReadTool(name: string): name is ReadTool {
  return (READ_TOOLS as readonly string[]).includes(name);
}
export function isWriteTool(name: string): name is WriteTool {
  return (WRITE_TOOLS as readonly string[]).includes(name);
}

/** Which tool definitions the model is allowed to see in this mode. */
export function visibleTools<T extends { function: { name: string } }>(all: readonly T[], mode: GuardMode): T[] {
  return all.filter((t) => isReadTool(t.function.name) || (mode === "executor" && isWriteTool(t.function.name)));
}

export function authorize(call: ToolCall, a: Authority): Verdict {
  if (isReadTool(call.name)) return { allow: true, kind: "read", tool: call.name };
  if (!isWriteTool(call.name)) return deny("NOT_ALLOWLISTED", `The tool ${String(call.name).slice(0, 60)} is not allowed.`);
  if (a.mode !== "executor") return deny("READ_ONLY_MODE", "This assistant can look but not change anything.");
  if (a.phase !== "EXECUTING" || !a.planVersionId) return deny("PLAN_NOT_EXECUTING", "Nothing can change until the owner's plan has started.");

  const parsed = WRITE_ARGS[call.name].safeParse(call.args);
  if (!parsed.success) return deny("BAD_ARGUMENTS", "The request didn't match what this tool accepts.");
  const args = parsed.data as Record<string, unknown>;

  const match = a.steps.find(({ step }) => {
    switch (call.name) {
      case "cancel_subscription":
        return step.type === "CANCEL_SUBSCRIPTION" && step.subscriptionId === args.subscription_id;
      case "cancel_sent_invoice":
        return step.type === "CANCEL_INVOICE" && step.invoiceId === args.invoice_id;
      case "pay_planned_obligation":
        return step.type === "PAY_OBLIGATION" && step.id === args.step_id;
    }
  });
  if (!match) return deny("NOT_IN_PLAN", "The owner’s confirmed plan doesn’t include this.");
  if (match.done) return deny("ALREADY_DONE", "This step has already been done.");
  if (match.step.type === "PAY_OBLIGATION" && match.step.dueAt > a.now) return deny("NOT_DUE", "This payment isn’t due yet.");
  return { allow: true, kind: "write", tool: call.name, step: match.step, requestId: moneyActionKey(a.planVersionId, match.step.id) };
}
