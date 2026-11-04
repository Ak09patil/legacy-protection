import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { planExecution, PlanDocumentSchema, summarisePlan, type PlanDocument } from "../src/index.js";

const DAY = 86_400_000;

const obligationArb = (i: number) =>
  fc.record({
    id: fc.constant(`ob-${i}`),
    kind: fc.constant("HOUSEHOLD_EMPLOYEE" as const),
    payeeName: fc.constant(`Carer ${i}`),
    payeeEmail: fc.constant(`carer${i}@example.com`),
    description: fc.constant("home care"),
    amountPerPaymentMinor: fc.integer({ min: 1_000, max: 100_000 }),
    maxPerMonthMinor: fc.integer({ min: 100_000, max: 500_000 }),
    currency: fc.constant("USD"),
    cadence: fc.constantFrom("WEEKLY" as const, "BIWEEKLY" as const, "MONTHLY" as const),
    continueForDaysAfterActivation: fc.integer({ min: 0, max: 120 }),
  });

const planArb: fc.Arbitrary<PlanDocument> = fc
  .record({
    obligations: fc.integer({ min: 0, max: 3 }).chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => obligationArb(i)))),
    cancelSubscriptions: fc.boolean(),
    cancelOpenInvoices: fc.boolean(),
  })
  .map((r) =>
    PlanDocumentSchema.parse({
      schemaVersion: 1,
      trustedContact: { name: "Priya", email: "priya@example.com" },
      checkin: { timeZone: "America/New_York", intervalDays: 7, localHour: 10, localMinute: 0 },
      waitingPeriodHours: 72,
      obligations: r.obligations,
      onActivation: { cancelSubscriptions: r.cancelSubscriptions, cancelOpenInvoices: r.cancelOpenInvoices, holdBalanceForEstate: true },
      contentVisibleTo: [],
    }),
  );

describe("execution planning", () => {
  it("INV-04 activated plan cannot pay unregistered payee", () => {
    fc.assert(
      fc.property(planArb, fc.integer({ min: 0, max: 2_000_000_000_000 }), (plan, activatedAt) => {
        const steps = planExecution(plan, { activeSubscriptionIds: ["I-1"], openInvoiceIds: ["INV-1"] }, activatedAt);
        const registered = new Set(plan.obligations.map((o) => o.payeeEmail));
        for (const s of steps) {
          if (s.type === "PAY_OBLIGATION") {
            expect(registered.has(s.payeeEmail)).toBe(true);
            expect(s.payeeEmail).not.toBe(plan.trustedContact.email);
          }
        }
      }),
      { numRuns: 500 },
    );
  });

  it("INV-04 obligation payments respect owner caps", () => {
    fc.assert(
      fc.property(planArb, fc.integer({ min: 0, max: 2_000_000_000_000 }), (plan, activatedAt) => {
        const steps = planExecution(plan, { activeSubscriptionIds: [], openInvoiceIds: [] }, activatedAt);
        for (const o of plan.obligations) {
          const pays = steps.filter((s) => s.type === "PAY_OBLIGATION" && s.obligationId === o.id);
          const byWindow = new Map<number, number>();
          for (const p of pays) {
            if (p.type !== "PAY_OBLIGATION") continue;
            expect(p.amountMinor).toBe(o.amountPerPaymentMinor);
            expect(p.dueAt).toBeLessThan(activatedAt + o.continueForDaysAfterActivation * DAY);
            const w = Math.floor((p.dueAt - activatedAt) / (30 * DAY));
            byWindow.set(w, (byWindow.get(w) ?? 0) + p.amountMinor);
          }
          for (const total of byWindow.values()) expect(total).toBeLessThanOrEqual(o.maxPerMonthMinor);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("step ids are unique, so idempotency keys are unique per action (INV-03)", () => {
    fc.assert(
      fc.property(planArb, (plan) => {
        const steps = planExecution(plan, { activeSubscriptionIds: ["a", "b"], openInvoiceIds: ["c"] }, 0);
        expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
      }),
    );
  });

  it("only cancels what the owner chose to cancel", () => {
    fc.assert(
      fc.property(planArb, (plan) => {
        const steps = planExecution(plan, { activeSubscriptionIds: ["a"], openInvoiceIds: ["b"] }, 0);
        expect(steps.some((s) => s.type === "CANCEL_SUBSCRIPTION")).toBe(plan.onActivation.cancelSubscriptions);
        expect(steps.some((s) => s.type === "CANCEL_INVOICE")).toBe(plan.onActivation.cancelOpenInvoices);
      }),
    );
  });
});

describe("plan schema and summary", () => {
  it("the summary always tells the owner the balance stays for the estate", () => {
    fc.assert(
      fc.property(planArb, (plan) => {
        expect(summarisePlan(plan).join(" ")).toMatch(/never sent to anyone/);
      }),
    );
  });

  it("INV-25 every language carries the same facts: same lines, every name, email and day count", () => {
    fc.assert(
      fc.property(planArb, (plan) => {
        const en = summarisePlan(plan, "en");
        for (const lang of ["de", "es"] as const) {
          const t = summarisePlan(plan, lang);
          expect(t).toHaveLength(en.length);
          const all = t.join(" ");
          expect(all).toContain(plan.trustedContact.name);
          expect(all).toContain(plan.trustedContact.email);
          for (const o of plan.obligations) {
            expect(all).toContain(o.payeeName);
            expect(all).toContain(` ${o.continueForDaysAfterActivation} `);
          }
        }
      }),
    );
  });

  it("the balance promise is in every language", () => {
    fc.assert(
      fc.property(planArb, (plan) => {
        expect(summarisePlan(plan, "de").join(" ")).toMatch(/schickt es nie an irgendjemanden/);
        expect(summarisePlan(plan, "es").join(" ")).toMatch(/nunca lo envía a nadie/);
      }),
    );
  });

  it("money and time follow the reader's conventions", () => {
    const plan = PlanDocumentSchema.parse({
      schemaVersion: 1,
      trustedContact: { name: "Priya", email: "priya@example.com" },
      checkin: { intervalDays: 7, localHour: 15, localMinute: 0, timeZone: "Europe/Berlin" },
      waitingPeriodHours: 72,
      onActivation: { cancelSubscriptions: true, cancelOpenInvoices: false, holdBalanceForEstate: true },
      obligations: [
        { id: "o1", kind: "HOUSEHOLD_EMPLOYEE", payeeName: "Maria", payeeEmail: "maria@example.com", description: "carer", amountPerPaymentMinor: 123450, currency: "USD", cadence: "WEEKLY", maxPerMonthMinor: 600000, continueForDaysAfterActivation: 60 },
      ],
      contentVisibleTo: [],
    });
    expect(summarisePlan(plan, "en").join(" ")).toMatch(/3:00 PM.*\$1,234\.50/s);
    expect(summarisePlan(plan, "de").join(" ")).toMatch(/15:00.*1\.234,50\s\$/s);
    expect(summarisePlan(plan, "es").join(" ")).toMatch(/15:00.*1\.?234,50\sUS\$/s);
  });
});
