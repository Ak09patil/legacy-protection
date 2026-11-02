import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  can,
  canViewContent,
  decide,
  evaluateRules,
  LEVELS,
  ROLES,
  type DecisionContext,
  type Level,
  type ModelSignal,
  type PaymentFacts,
  type RuleResult,
} from "../src/index.js";

const rank = (l: Level) => LEVELS.indexOf(l);
const ctx = (caregiver = false): DecisionContext => ({
  payeeIsRegisteredCaregiver: caregiver,
  policyVersion: "test",
  planVersionId: "pv1",
});

const reason = { code: "X", text: "x", source: "MODEL" as const };
const levelArb = fc.constantFrom<Level>(...LEVELS);
const ruleArb: fc.Arbitrary<RuleResult> = levelArb.map((level) => ({
  level,
  reasons: level === "PASS" ? [] : [{ code: "R", text: "r", source: "RULE" as const }],
}));
const signalArb: fc.Arbitrary<ModelSignal> = fc.record({
  level: levelArb,
  networkOnly: fc.boolean(),
  modelVersion: fc.constant("m1"),
}).map((s) => ({ ...s, reasons: s.level === "PASS" ? [] : [reason] }));

describe("decide", () => {
  it("INV-11 property: models never lower the rules' decision", () => {
    fc.assert(
      fc.property(ruleArb, fc.array(signalArb, { maxLength: 4 }), fc.boolean(), (rules, signals, cg) => {
        const d = decide(rules, { status: "OK", signals }, ctx(cg));
        expect(rank(d.level)).toBeGreaterThanOrEqual(rank(rules.level));
      }),
    );
  });

  it("INV-10 unavailable model holds the payment", () => {
    fc.assert(
      fc.property(ruleArb, (rules) => {
        const d = decide(rules, { status: "UNAVAILABLE", detail: "timeout" }, ctx());
        expect(d.level).toBe("HOLD");
        expect(d.reasons.map((r) => r.code)).toContain("DEPENDENCY_UNAVAILABLE");
      }),
    );
  });

  it("INV-10 malformed model output holds the payment", () => {
    const bad = { level: "HOLD" as const, reasons: [], networkOnly: false, modelVersion: "m1" };
    const d = decide({ level: "PASS", reasons: [] }, { status: "OK", signals: [bad] }, ctx());
    expect(d.level).toBe("HOLD");
  });

  it("INV-12 property: every review or hold has a reason", () => {
    fc.assert(
      fc.property(ruleArb, fc.array(signalArb, { maxLength: 4 }), fc.boolean(), (rules, signals, cg) => {
        const d = decide(rules, { status: "OK", signals }, ctx(cg));
        if (d.level !== "PASS") expect(d.reasons.length).toBeGreaterThan(0);
      }),
    );
  });

  it("INV-14 registered caregiver with only a network signal is capped at review", () => {
    const network: ModelSignal = { level: "HOLD", reasons: [reason], networkOnly: true, modelVersion: "s1" };
    expect(decide({ level: "PASS", reasons: [] }, { status: "OK", signals: [network] }, ctx(true)).level).toBe("REVIEW");
    // Same signal on an unregistered payee still holds.
    expect(decide({ level: "PASS", reasons: [] }, { status: "OK", signals: [network] }, ctx(false)).level).toBe("HOLD");
  });

  it("INV-14 the cap never overrides a hard rule on a caregiver", () => {
    const network: ModelSignal = { level: "HOLD", reasons: [reason], networkOnly: true, modelVersion: "s1" };
    const rules: RuleResult = { level: "HOLD", reasons: [{ code: "R", text: "r", source: "RULE" }] };
    expect(decide(rules, { status: "OK", signals: [network] }, ctx(true)).level).toBe("HOLD");
  });

  it("INV-16 decisions record the versions that produced them", () => {
    const d = decide({ level: "PASS", reasons: [] }, { status: "OK", signals: [] }, ctx());
    expect(d.policyVersion).toBe("test");
    expect(d.planVersionId).toBe("pv1");
  });
});

describe("rules", () => {
  const base: PaymentFacts = {
    payeeIsNew: false,
    payeeIsRegisteredCaregiver: false,
    amountRatioToTypical: 1,
    textLabels: [],
    withinRegisteredObligationCap: true,
  };

  it("holds a new payee asking for gift cards", () => {
    const r = evaluateRules({ ...base, payeeIsNew: true, textLabels: ["GIFT_CARD_REQUEST"] });
    expect(r.level).toBe("HOLD");
    expect(r.reasons[0]?.code).toBe("NEW_PAYEE_GIFT_CARD_OR_CRYPTO");
  });

  it("holds urgent government impersonation from a new payee", () => {
    const r = evaluateRules({ ...base, payeeIsNew: true, textLabels: ["URGENCY", "IMPERSONATION_GOVERNMENT"] });
    expect(r.level).toBe("HOLD");
  });

  it("reviews an unusually large first payment", () => {
    expect(evaluateRules({ ...base, payeeIsNew: true, amountRatioToTypical: 6 }).level).toBe("REVIEW");
  });

  it("passes an ordinary payment to a known payee", () => {
    expect(evaluateRules(base)).toEqual({ level: "PASS", reasons: [] });
  });
});

describe("roles", () => {
  it("INV-08 role permission matrix", () => {
    expect(can("TRUSTED_CONTACT", "PLAN_EDIT")).toBe(false);
    expect(can("TRUSTED_CONTACT", "PAYEE_REGISTER")).toBe(false);
    expect(can("TRUSTED_CONTACT", "HOLD_RELEASE")).toBe(false);
    expect(can("TRUSTED_CONTACT", "RECEIVE_PLAN_FUNDS")).toBe(false);
    expect(can("TRUSTED_CONTACT", "TRIGGER_CONFIRM")).toBe(true);
    expect(can("EXECUTOR", "PLAN_EDIT")).toBe(false);
  });

  it("INV-08 no role may receive plan funds", () => {
    for (const r of ROLES) expect(can(r, "RECEIVE_PLAN_FUNDS")).toBe(false);
  });

  it("INV-01 only the system executor can execute plan steps", () => {
    for (const r of ROLES) expect(can(r, "EXECUTE_PLAN_STEP")).toBe(r === "SYSTEM_EXECUTOR");
  });

  it("INV-17 contact view excludes content unless the owner allowed it", () => {
    expect(canViewContent("TRUSTED_CONTACT", [])).toBe(false);
    expect(canViewContent("TRUSTED_CONTACT", ["TRUSTED_CONTACT"])).toBe(true);
    expect(canViewContent("SYSTEM_EXECUTOR", ["SYSTEM_EXECUTOR"])).toBe(false);
  });
});
