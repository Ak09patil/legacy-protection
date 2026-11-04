import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { planExecution, PlanDocumentSchema } from "@lp/policy";
import { authorize, READ_TOOLS, visibleTools, WRITE_TOOLS, type Authority, type PlannedStep } from "../src/index.js";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 20, 15);

const plan = PlanDocumentSchema.parse({
  schemaVersion: 1,
  trustedContact: { name: "Priya", email: "priya@example.com" },
  checkin: { timeZone: "America/New_York", intervalDays: 7, localHour: 10, localMinute: 0 },
  waitingPeriodHours: 72,
  obligations: [
    {
      id: "maria-care",
      kind: "HOUSEHOLD_EMPLOYEE",
      payeeName: "Maria",
      payeeEmail: "maria@example.com",
      description: "home care",
      amountPerPaymentMinor: 32000,
      maxPerMonthMinor: 140000,
      currency: "USD",
      cadence: "WEEKLY",
      continueForDaysAfterActivation: 60,
    },
  ],
  onActivation: { cancelSubscriptions: true, cancelOpenInvoices: true, holdBalanceForEstate: true },
  contentVisibleTo: [],
});
const steps: PlannedStep[] = planExecution(plan, { activeSubscriptionIds: ["I-STREAMTV"], openInvoiceIds: ["INV2-QUILT"] }, T0).map((step) => ({ step, done: false }));

const executing = (over: Partial<Authority> = {}): Authority => ({
  mode: "executor",
  phase: "EXECUTING",
  planVersionId: "pv-1",
  steps,
  now: T0 + 1000,
  ...over,
});

describe("guard", () => {
  it("INV-01 an advisor can read but never change anything", () => {
    expect(authorize({ name: "list_transactions", args: {} }, executing({ mode: "advisor" })).allow).toBe(true);
    const v = authorize({ name: "cancel_subscription", args: { subscription_id: "I-STREAMTV", payload: { reason: "x" } } }, executing({ mode: "advisor" }));
    expect(v).toMatchObject({ allow: false, code: "READ_ONLY_MODE" });
  });

  it("INV-01 tools that move money in other ways are never allowed, in any mode", () => {
    for (const name of ["create_refund", "pay_order", "create_order", "send_invoice", "create_invoice", "accept_dispute_claim", "update_subscription"]) {
      expect(authorize({ name, args: {} }, executing())).toMatchObject({ allow: false, code: "NOT_ALLOWLISTED" });
    }
  });

  it("INV-02 nothing changes until the plan is executing", () => {
    for (const phase of ["DRAFT", "MONITORING", "WAITING", "ACTIVATED", "COMPLETED", "CANCELLED"] as const) {
      expect(authorize({ name: "cancel_subscription", args: { subscription_id: "I-STREAMTV" } }, executing({ phase }))).toMatchObject({
        allow: false,
        code: "PLAN_NOT_EXECUTING",
      });
    }
  });

  it("INV-02 only subscriptions and invoices the plan listed can be cancelled", () => {
    expect(authorize({ name: "cancel_subscription", args: { subscription_id: "I-STREAMTV" } }, executing())).toMatchObject({ allow: true, kind: "write" });
    expect(authorize({ name: "cancel_subscription", args: { subscription_id: "I-SOMETHINGELSE" } }, executing())).toMatchObject({ allow: false, code: "NOT_IN_PLAN" });
    expect(authorize({ name: "cancel_sent_invoice", args: { invoice_id: "INV2-QUILT" } }, executing())).toMatchObject({ allow: true });
    expect(authorize({ name: "cancel_sent_invoice", args: { invoice_id: "INV2-OTHER" } }, executing())).toMatchObject({ allow: false, code: "NOT_IN_PLAN" });
  });

  it("INV-04 the model can't set a payee or amount: extra arguments are refused", () => {
    const v = authorize({ name: "pay_planned_obligation", args: { step_id: "pay:maria-care:0", amount: "99999", receiver: "scammer@example.com" } }, executing());
    expect(v).toMatchObject({ allow: false, code: "BAD_ARGUMENTS" });
  });

  it("INV-04 an allowed payout carries the plan's payee and amount, not the model's", () => {
    const v = authorize({ name: "pay_planned_obligation", args: { step_id: "pay:maria-care:0" } }, executing());
    expect(v.allow).toBe(true);
    if (v.allow && v.kind === "write" && v.step.type === "PAY_OBLIGATION") {
      expect(v.step.payeeEmail).toBe("maria@example.com");
      expect(v.step.amountMinor).toBe(32000);
    }
  });

  it("INV-03 a done step can't run again, and each step has one stable request id", () => {
    const a = authorize({ name: "pay_planned_obligation", args: { step_id: "pay:maria-care:0" } }, executing());
    const b = authorize({ name: "pay_planned_obligation", args: { step_id: "pay:maria-care:0" } }, executing());
    expect(a.allow && a.kind === "write" && b.allow && b.kind === "write" && a.requestId === b.requestId).toBe(true);
    const done = steps.map((s) => (s.step.id === "pay:maria-care:0" ? { ...s, done: true } : s));
    expect(authorize({ name: "pay_planned_obligation", args: { step_id: "pay:maria-care:0" } }, executing({ steps: done }))).toMatchObject({
      allow: false,
      code: "ALREADY_DONE",
    });
  });

  it("INV-04 future care payments can't be paid early", () => {
    expect(authorize({ name: "pay_planned_obligation", args: { step_id: "pay:maria-care:1" } }, executing())).toMatchObject({ allow: false, code: "NOT_DUE" });
    expect(authorize({ name: "pay_planned_obligation", args: { step_id: "pay:maria-care:1" } }, executing({ now: T0 + 8 * DAY }))).toMatchObject({ allow: true });
  });

  it("INV-01 the advisor never even sees write tools", () => {
    const all = [...READ_TOOLS, ...WRITE_TOOLS, "create_refund"].map((name) => ({ function: { name } }));
    expect(visibleTools(all, "advisor").map((t) => t.function.name)).toEqual([...READ_TOOLS]);
    expect(visibleTools(all, "executor").map((t) => t.function.name)).toEqual([...READ_TOOLS, ...WRITE_TOOLS]);
  });

  it("INV-02 property: whatever the model asks, an allowed write always matches an undone, due step in the plan", () => {
    const names = fc.oneof(fc.constantFrom(...READ_TOOLS, ...WRITE_TOOLS, "create_refund", "pay_order"), fc.string({ maxLength: 30 }));
    const ids = fc.oneof(fc.constantFrom("I-STREAMTV", "INV2-QUILT", "pay:maria-care:0", "pay:maria-care:3", "pay:maria-care:999"), fc.string({ maxLength: 20 }));
    const args = fc.record({ subscription_id: ids, invoice_id: ids, step_id: ids, amount: fc.string(), receiver: fc.emailAddress() }, { requiredKeys: [] });
    fc.assert(
      fc.property(names, args, fc.constantFrom("advisor", "executor"), fc.integer({ min: 0, max: 70 }), (name, a, mode, day) => {
        const auth = executing({ mode: mode as "advisor" | "executor", now: T0 + day * DAY });
        const v = authorize({ name, args: a }, auth);
        if (!v.allow || v.kind === "read") return true;
        const s = auth.steps.find((x) => x.step.id === v.step.id);
        return mode === "executor" && !!s && !s.done && (s.step.type !== "PAY_OBLIGATION" || s.step.dueAt <= auth.now);
      }),
      { numRuns: 2000 },
    );
  });
});
