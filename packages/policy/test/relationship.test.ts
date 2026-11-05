import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { evaluateRules, relationshipFacts, RELATIONSHIP_POLICY, type HistoryPayment, type PaymentFacts } from "../src/index.js";

const DAY = 86_400_000;
const NOW = new Date("2026-11-05T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const $ = (dollars: number) => Math.round(dollars * 100);

/** A year of ordinary life: rent, groceries, a pharmacy, a grandchild's birthday. */
function ordinaryYear(): HistoryPayment[] {
  const h: HistoryPayment[] = [];
  for (let m = 12; m >= 1; m--) {
    h.push({ payeeId: "landlord@example.com", amountMinor: $(1200), at: ago(m * 30 + 2) });
    h.push({ payeeId: "grocer@example.com", amountMinor: $(140 + (m % 3) * 15), at: ago(m * 30 - 5) });
    h.push({ payeeId: "pharmacy@example.com", amountMinor: $(42), at: ago(m * 30 - 12) });
  }
  h.push({ payeeId: "grandkid@example.com", amountMinor: $(50), at: ago(200) });
  return h;
}

function check(sent: HistoryPayment[], payeeId: string, amountMinor: number, opts: { waiting?: HistoryPayment[]; labels?: PaymentFacts["textLabels"] } = {}) {
  const relationship = relationshipFacts(sent, opts.waiting ?? [], payeeId, amountMinor, NOW);
  return evaluateRules({
    payeeIsNew: !sent.some((h) => h.payeeId === payeeId),
    payeeIsRegisteredCaregiver: false,
    amountRatioToTypical: null,
    textLabels: opts.labels ?? [],
    withinRegisteredObligationCap: true,
    amountMinor,
    relationship,
  });
}
const codes = (r: ReturnType<typeof check>) => r.reasons.map((x) => x.code);

describe("INV-27 slow scams: the relationship, not just the payment", () => {
  it("the classic pig-butchering curve is asked about, then paused, long before the big losses", () => {
    // $200, $500, $1,500, $5,000, $15,000... a week or two apart, to someone met online.
    const sent: HistoryPayment[] = ordinaryYear();
    const curve = [200, 500, 1500, 5000, 15000];
    const levels: string[] = [];
    curve.forEach((amt, i) => {
      const r = check(sent, "mentor@trade.example", $(amt));
      levels.push(r.level);
      // Suppose she says yes every time we only ask (REVIEW), and the money goes.
      if (r.level !== "HOLD") sent.push({ payeeId: "mentor@trade.example", amountMinor: $(amt), at: ago(40 - i * 10) });
    });
    expect(levels[1]).toBe("REVIEW"); // $500 after $200: escalating
    expect(levels).toContain("HOLD");
    const firstHold = levels.indexOf("HOLD");
    const lostBeforeHold = curve.slice(0, firstHold).reduce((a, b) => a + b, 0);
    expect(lostBeforeHold).toBeLessThanOrEqual(2500); // never more than the floor before we pause
  });

  it("splitting into many small payments doesn't get past the total", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 50, max: 400 }), { minLength: 5, maxLength: 40 }), (chunks) => {
        const sent = ordinaryYear();
        let held = false;
        let total = 0;
        chunks.forEach((amt, i) => {
          const r = check(sent, "friend@chat.example", $(amt));
          if (r.level === "HOLD") held = true;
          else {
            total += amt;
            sent.push({ payeeId: "friend@chat.example", amountMinor: $(amt), at: ago(100 - i * 2) });
          }
        });
        // However it's sliced, what goes out before a pause never passes the threshold by more than one payment.
        if (!held) expect(total).toBeLessThan(RELATIONSHIP_POLICY.payeeTotalFloorMinor / 100 + 400);
      }),
      { numRuns: 300 },
    );
  });

  it("moving her to a new account each time doesn't reset anything", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 300, max: 2400 }), { minLength: 2, maxLength: 12 }), (amounts) => {
        const sent = ordinaryYear();
        let goneOut = 0;
        amounts.forEach((amt, i) => {
          const payee = `mule${i}@pay.example`; // a different account every time
          const r = check(sent, payee, $(amt));
          if (r.level !== "HOLD") {
            goneOut += amt;
            sent.push({ payeeId: payee, amountMinor: $(amt), at: ago(25 - i * 2) });
          }
        });
        expect(goneOut).toBeLessThan(RELATIONSHIP_POLICY.spreadFloorMinor / 100 + 2400);
      }),
      { numRuns: 300 },
    );
  });

  it("queueing several payments at once doesn't get past the total either", () => {
    const sent = ordinaryYear();
    sent.push({ payeeId: "friend@chat.example", amountMinor: $(300), at: ago(40) });
    const waiting = [
      { payeeId: "friend@chat.example", amountMinor: $(900), at: ago(0) },
      { payeeId: "friend@chat.example", amountMinor: $(900), at: ago(0) },
    ];
    expect(check(sent, "friend@chat.example", $(900), { waiting }).level).toBe("HOLD");
  });

  it("alternating big and small amounts still counts as escalating", () => {
    const sent = ordinaryYear();
    for (const [i, a] of [100, 400, 100, 450, 120].entries()) sent.push({ payeeId: "x@chat.example", amountMinor: $(a), at: ago(60 - i * 7) });
    expect(codes(check(sent, "x@chat.example", $(600)))).toContain("RECENT_PAYEE_ESCALATING");
  });

  it("a 'fee to release your profits' is always paused, whoever it's to", () => {
    const sent = ordinaryYear();
    expect(check(sent, "grocer@example.com", $(50), { labels: ["WITHDRAWAL_FEE"] }).level).toBe("HOLD");
    expect(check(sent, "new@x.example", $(50), { labels: ["WITHDRAWAL_FEE"] }).level).toBe("HOLD");
  });

  it("romance plus any money pressure is paused; romance alone to someone recent is asked about", () => {
    const sent = ordinaryYear();
    sent.push({ payeeId: "sweetheart@x.example", amountMinor: $(80), at: ago(20) });
    expect(check(sent, "sweetheart@x.example", $(90), { labels: ["ROMANCE"] }).level).toBe("REVIEW");
    expect(check(sent, "sweetheart@x.example", $(90), { labels: ["ROMANCE", "URGENCY"] }).level).toBe("HOLD");
    // A husband of 30 years saying "I love you" in a note is no one's business.
    expect(check(sent, "landlord@example.com", $(1200), { labels: ["ROMANCE"] }).level).toBe("PASS");
  });
});

describe("INV-27 ordinary life is left alone", () => {
  it("a year of steady bills never trips the slow-scam rules", () => {
    const h = ordinaryYear();
    for (const p of ["landlord@example.com", "grocer@example.com", "pharmacy@example.com"]) {
      const last = h.filter((x) => x.payeeId === p).at(-1)!;
      expect(check(h, p, last.amountMinor).level).toBe("PASS");
    }
  });

  it("any steady amount to an established payee passes, however large", () => {
    fc.assert(
      fc.property(fc.integer({ min: 10, max: 20_000 }), fc.integer({ min: 3, max: 12 }), (amt, months) => {
        const h: HistoryPayment[] = Array.from({ length: months }, (_, i) => ({ payeeId: "old@example.com", amountMinor: $(amt), at: ago(200 + i * 30) }));
        expect(check(h, "old@example.com", $(amt)).level).toBe("PASS");
      }),
    );
  });

  it("a new monthly bill is asked about once it adds up, but never paused as a scam", () => {
    const h = ordinaryYear();
    h.push({ payeeId: "newlandlord@example.com", amountMinor: $(1900), at: ago(31) });
    const r = check(h, "newlandlord@example.com", $(1900));
    expect(r.level).toBe("REVIEW");
    expect(codes(r)).toEqual(["RECENT_PAYEE_LARGE_TOTAL_BILL"]);
  });

  it("thresholds scale with the owner's own spending, and a scam already under way can't raise its own threshold", () => {
    const rich: HistoryPayment[] = [];
    for (let m = 6; m >= 1; m--) rich.push({ payeeId: "estate@example.com", amountMinor: $(9000), at: ago(m * 30 + 70) }, { payeeId: "estate@example.com", amountMinor: $(9000), at: ago(m * 30) });
    const f = relationshipFacts(rich, [], "x@y.example", $(10), NOW);
    expect(f.baselineMonthlyMinor).toBeGreaterThan($(9000));
    // Recent payees aren't part of the baseline.
    const withScam = [...rich, { payeeId: "scam@x.example", amountMinor: $(50_000), at: ago(10) }];
    expect(relationshipFacts(withScam, [], "x@y.example", $(10), NOW).baselineMonthlyMinor).toBe(f.baselineMonthlyMinor);
  });

  it("brand-new owners with no history get the fixed floors, not zero", () => {
    const f = relationshipFacts([], [], "a@b.example", $(100), NOW);
    expect(f.baselineMonthlyMinor).toBeNull();
    const sent = [{ payeeId: "a@b.example", amountMinor: $(1500), at: ago(5) }];
    expect(check(sent, "a@b.example", $(1200)).level).toBe("HOLD"); // $2,700 to someone met 5 days ago
  });
});
