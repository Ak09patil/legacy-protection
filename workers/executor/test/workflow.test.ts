/**
 * Runs the real workflow on Temporal's time-skipping test server: months of
 * timers pass in milliseconds, and signals arrive at chosen moments.
 * Activities are in-memory fakes that behave like idempotent PayPal calls.
 */
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { bundleWorkflowCode, Worker, type WorkflowBundleWithSourceMap } from "@temporalio/worker";
import type { ExecutionStep } from "@lp/policy";
import type { Activities, CheckinWindow } from "../src/activity-types.js";
import {
  contactConfirmedSignal,
  ownerActivitySignal,
  stateQuery,
  type PlanLifecycleInput,
} from "../src/workflows.js";

const H = 3_600_000;
const DAY = 24 * H;
const WAIT = 72 * H;

let env: TestWorkflowEnvironment;
let bundle: WorkflowBundleWithSourceMap;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
  bundle = await bundleWorkflowCode({
    workflowsPath: fileURLToPath(new URL("../src/workflows.ts", import.meta.url)),
    logger: { log: () => {}, trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  });
}, 120_000);

afterAll(async () => {
  await env?.teardown();
});

class Fakes {
  audit: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  ownerNotices: string[] = [];
  contactNotices: string[] = [];
  reminders = 0;
  /** Effects keyed like PayPal-Request-Id: (planVersionId, stepId). */
  effects = new Map<string, number>();
  attempts = new Map<string, number>();
  failFirst = new Map<string, number>();

  steps: ExecutionStep[] = [
    { id: "cancel-sub:I-1", type: "CANCEL_SUBSCRIPTION", subscriptionId: "I-1" },
    { id: "pay:maria:0", type: "PAY_OBLIGATION", obligationId: "maria", payeeEmail: "maria@example.com", amountMinor: 32000, currency: "USD", dueAt: 0 },
    { id: "pay:maria:1", type: "PAY_OBLIGATION", obligationId: "maria", payeeEmail: "maria@example.com", amountMinor: 32000, currency: "USD", dueAt: 7 * DAY },
    { id: "executor-package", type: "ASSEMBLE_EXECUTOR_PACKAGE" },
  ];

  activities(): Activities {
    return {
      nextCheckin: async (_p, last): Promise<CheckinWindow> => {
        const dueAt = last + 7 * DAY;
        return { dueAt, reminders: [dueAt + 24 * H, dueAt + 48 * H], missedAt: dueAt + 72 * H };
      },
      sendCheckinReminder: async () => {
        this.reminders++;
      },
      notifyOwnerAllChannels: async (_p, r) => {
        this.ownerNotices.push(r);
      },
      notifyContact: async (_p, r) => {
        this.contactNotices.push(r);
      },
      audit: async (_p, kind, payload) => {
        this.audit.push({ kind, payload });
      },
      planSteps: async (_p, _v, activatedAt) =>
        this.steps.map((s) => (s.type === "PAY_OBLIGATION" ? { ...s, dueAt: activatedAt + s.dueAt } : s)),
      executeStep: async (_p, version, step) => {
        const key = `${version}:${step.id}`;
        const n = (this.attempts.get(key) ?? 0) + 1;
        this.attempts.set(key, n);
        if (!this.effects.has(key)) this.effects.set(key, 1); // PayPal acts once per request id
        if (n <= (this.failFirst.get(step.id) ?? 0)) throw new Error("connection reset after send");
        return { outcome: "DONE" };
      },
    };
  }

  transitions(): string[] {
    return this.audit.filter((a) => a.kind === "LIFECYCLE").map((a) => `${a.payload.event}->${a.payload.to}`);
  }
}

async function start(f: Fakes, id: string) {
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: id,
    workflowBundle: bundle,
    activities: f.activities(),
  });
  const input: PlanLifecycleInput = { planId: id, planVersionId: `${id}-v1`, waitingPeriodMs: WAIT };
  return { worker, input };
}

describe("plan lifecycle workflow", () => {
  it("runs the full path: missed check-ins, passkey confirmation, waiting period, execution", async () => {
    const f = new Fakes();
    const { worker, input } = await start(f, "full-path");
    await worker.runUntil(async () => {
      const h = await env.client.workflow.start("planLifecycle", { taskQueue: "full-path", workflowId: "full-path", args: [input] });
      await env.sleep(7 * DAY + 72 * H + H); // check-in due, both reminders, then missed
      expect((await h.query(stateQuery)).checkinsMissed).toBe(true);
      await h.signal(contactConfirmedSignal, { passkeyVerified: true });
      const final = await h.result();
      expect(final.phase).toBe("COMPLETED");
    });
    expect(f.reminders).toBe(2);
    expect(f.ownerNotices).toEqual(["CONTACT_CONFIRMED", "WAITING_STARTED", "ACTIVATED"]);
    expect([...f.effects.keys()].sort()).toEqual(f.steps.map((s) => `full-path-v1:${s.id}`).sort());
    expect(f.transitions()).toEqual([
      "PLAN_CONFIRMED->MONITORING",
      "CHECKIN_SEQUENCE_MISSED->MONITORING",
      "CONTACT_CONFIRMED->WAITING",
      "WAITING_PERIOD_CHECK->ACTIVATED",
      "EXECUTION_STARTED->EXECUTING",
      "EXECUTION_COMPLETED->COMPLETED",
    ]);
  }, 60_000);

  it("INV-07 owner activity during the waiting period cancels activation and nothing executes", async () => {
    const f = new Fakes();
    const { worker, input } = await start(f, "owner-returns");
    await worker.runUntil(async () => {
      const h = await env.client.workflow.start("planLifecycle", { taskQueue: "owner-returns", workflowId: "owner-returns", args: [input] });
      await env.sleep(7 * DAY + 72 * H + H);
      await h.signal(contactConfirmedSignal, { passkeyVerified: true });
      await env.sleep(24 * H); // a day into the 72-hour wait
      expect((await h.query(stateQuery)).phase).toBe("WAITING");
      await h.signal(ownerActivitySignal);
      await env.sleep(H);
      const s = await h.query(stateQuery);
      expect(s.phase).toBe("MONITORING");
      expect(s.checkinsMissed).toBe(false);
      await env.sleep(10 * DAY); // well past when activation would have happened
      expect((await h.query(stateQuery)).phase).not.toBe("ACTIVATED");
      await h.terminate("test complete");
    });
    expect(f.effects.size).toBe(0);
    expect(f.contactNotices).toContain("ACTIVATION_CANCELLED_BY_OWNER");
  }, 60_000);

  it("INV-06 a contact confirmation without a passkey changes nothing", async () => {
    const f = new Fakes();
    const { worker, input } = await start(f, "no-passkey");
    await worker.runUntil(async () => {
      const h = await env.client.workflow.start("planLifecycle", { taskQueue: "no-passkey", workflowId: "no-passkey", args: [input] });
      await env.sleep(7 * DAY + 72 * H + H);
      await h.signal(contactConfirmedSignal, { passkeyVerified: false });
      await env.sleep(30 * DAY);
      const s = await h.query(stateQuery);
      expect(s.phase).toBe("MONITORING");
      expect(s.contactConfirmed).toBe(false);
      await h.terminate("test complete");
    });
    expect(f.effects.size).toBe(0);
  }, 60_000);

  it("INV-03 a payment that fails after PayPal acted is retried with the same key and pays once", async () => {
    const f = new Fakes();
    f.failFirst.set("pay:maria:0", 2);
    const { worker, input } = await start(f, "retry");
    await worker.runUntil(async () => {
      const h = await env.client.workflow.start("planLifecycle", { taskQueue: "retry", workflowId: "retry", args: [input] });
      await env.sleep(7 * DAY + 72 * H + H);
      await h.signal(contactConfirmedSignal, { passkeyVerified: true });
      expect((await h.result()).phase).toBe("COMPLETED");
    });
    expect(f.attempts.get("retry-v1:pay:maria:0")).toBe(3);
    expect(f.effects.get("retry-v1:pay:maria:0")).toBe(1);
  }, 60_000);

  it("INV-03 chaos: kill the worker between scheduled payouts and a new worker finishes without paying twice", async () => {
    const f = new Fakes();
    const id = "chaos";
    const input: PlanLifecycleInput = { planId: id, planVersionId: `${id}-v1`, waitingPeriodMs: WAIT };
    // No workflow cache: a worker that dies takes nothing with it, and the next one
    // rebuilds the workflow purely by replaying its event history.
    const mk = () =>
      Worker.create({
        connection: env.nativeConnection,
        taskQueue: id,
        workflowBundle: bundle,
        activities: f.activities(),
        maxCachedWorkflows: 0,
      });

    const first = await mk();
    const h = await first.runUntil(async () => {
      const handle = await env.client.workflow.start("planLifecycle", { taskQueue: id, workflowId: id, args: [input] });
      await env.sleep(7 * DAY + 72 * H + H);
      await handle.signal(contactConfirmedSignal, { passkeyVerified: true });
      await env.sleep(WAIT + H); // activated; first payment done, second is a week away
      return handle;
    });
    // First worker is gone mid-schedule. A fresh worker picks up the same workflow.
    const paidBeforeCrash = f.effects.get("chaos-v1:pay:maria:0");
    const second = await mk();
    await second.runUntil(async () => {
      expect((await h.result()).phase).toBe("COMPLETED");
    });
    expect(paidBeforeCrash).toBe(1);
    for (const s of f.steps) expect(f.effects.get(`chaos-v1:${s.id}`)).toBe(1);
  }, 90_000);
});
