import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  add,
  compare,
  initialState,
  MIN_WAITING_PERIOD_MS,
  money,
  moneyActionKey,
  parseDecimal,
  run,
  toDecimal,
  transition,
  type LifecycleEvent,
  type LifecycleState,
} from "../src/index.js";

describe("money", () => {
  it("INV-05 rejects non-integer minor units", () => {
    expect(() => money(10.5, "USD")).toThrow();
    expect(() => money(Number.MAX_SAFE_INTEGER + 1, "USD")).toThrow();
  });

  it("INV-05 rejects mixed-currency arithmetic", () => {
    expect(() => add(money(100, "USD"), money(100, "EUR"))).toThrow(/Currency mismatch/);
    expect(() => compare(money(1, "USD"), money(1, "INR"))).toThrow();
  });

  it("INV-05 property: parse and format round-trip exactly", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }), (minor) => {
        const m = money(minor, "USD");
        expect(parseDecimal(toDecimal(m), "USD")).toEqual(m);
      }),
    );
  });

  it("INV-05 rejects float-like strings", () => {
    expect(() => parseDecimal("1e3", "USD")).toThrow();
    expect(() => parseDecimal("12.345", "USD")).toThrow();
    expect(parseDecimal("0.10", "USD").minor).toBe(10n);
  });
});

describe("idempotency", () => {
  it("INV-03 same plan version and step always give the same key", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), (v, s) => {
        expect(moneyActionKey(v, s)).toBe(moneyActionKey(v, s));
        expect(moneyActionKey(v, s).length).toBeLessThanOrEqual(108);
      }),
    );
  });

  it("INV-03 different steps never collide", () => {
    expect(moneyActionKey("v1", "a")).not.toBe(moneyActionKey("v1", "b"));
    // Separator prevents ("ab","c") colliding with ("a","bc").
    expect(moneyActionKey("ab", "c")).not.toBe(moneyActionKey("a", "bc"));
  });
});

describe("lifecycle", () => {
  const H = 60 * 60 * 1000;
  const W = MIN_WAITING_PERIOD_MS;
  const confirmed = run([{ type: "PLAN_CONFIRMED", planVersionId: "pv1", waitingPeriodMs: W, at: 0 }]);

  it("activates only after missed check-ins, passkey confirmation and the full wait", () => {
    const s = run(
      [
        { type: "CHECKIN_SEQUENCE_MISSED", at: 1 * H },
        { type: "CONTACT_CONFIRMED", passkeyVerified: true, at: 2 * H },
        { type: "WAITING_PERIOD_CHECK", at: 2 * H + W - 1 },
      ],
      confirmed,
    );
    expect(s.phase).toBe("WAITING");
    expect(transition(s, { type: "WAITING_PERIOD_CHECK", at: 2 * H + W }).state.phase).toBe("ACTIVATED");
  });

  it("rejects contact confirmation without a passkey", () => {
    const t = transition(confirmed, { type: "CONTACT_CONFIRMED", passkeyVerified: false, at: 1 });
    expect(t.state).toEqual(confirmed);
    expect(t.effects[0]?.type).toBe("REJECTED");
  });

  it("tells the owner on every channel the moment a contact confirms", () => {
    const t = transition(confirmed, { type: "CONTACT_CONFIRMED", passkeyVerified: true, at: 1 });
    expect(t.effects).toContainEqual({ type: "NOTIFY_OWNER_ALL_CHANNELS", reason: "CONTACT_CONFIRMED" });
  });

  it("rejects a waiting period below the minimum", () => {
    const t = transition(initialState, { type: "PLAN_CONFIRMED", planVersionId: "pv", waitingPeriodMs: W - 1, at: 0 });
    expect(t.state.phase).toBe("DRAFT");
  });

  const eventArb: fc.Arbitrary<LifecycleEvent> = fc.oneof(
    fc.record({ type: fc.constant("CHECKIN_SEQUENCE_MISSED" as const), at: fc.nat() }),
    fc.record({ type: fc.constant("CONTACT_CONFIRMED" as const), passkeyVerified: fc.boolean(), at: fc.nat() }),
    fc.record({ type: fc.constant("WAITING_PERIOD_CHECK" as const), at: fc.nat() }),
    fc.record({ type: fc.constant("OWNER_ACTIVITY" as const), at: fc.nat() }),
    fc.record({ type: fc.constant("EXECUTION_STARTED" as const), at: fc.nat() }),
  );

  // Times must move forward, as they do in reality.
  const sequenceArb = fc
    .array(eventArb, { maxLength: 40 })
    .map((evs) => {
      let t = 0;
      return evs.map((e) => ({ ...e, at: (t += (e.at % (2 * W)) + 1) }));
    });

  it("INV-06 property: no sequence reaches ACTIVATED without all three conditions since the last owner activity", () => {
    fc.assert(
      fc.property(sequenceArb, (events) => {
        let s: LifecycleState = confirmed;
        let missed = false;
        let passkeyConfirmed = false;
        let waitStart: number | null = null;
        for (const e of events) {
          const before = s;
          s = transition(s, e).state;
          if (e.type === "OWNER_ACTIVITY" && before.phase !== "EXECUTING") {
            missed = false;
            passkeyConfirmed = false;
            waitStart = null;
          }
          if (before.phase === "MONITORING") {
            if (e.type === "CHECKIN_SEQUENCE_MISSED") missed = true;
            if (e.type === "CONTACT_CONFIRMED" && e.passkeyVerified) passkeyConfirmed = true;
          }
          if (before.phase !== "WAITING" && s.phase === "WAITING") waitStart = e.at;
          if (before.phase !== "ACTIVATED" && s.phase === "ACTIVATED") {
            expect(missed).toBe(true);
            expect(passkeyConfirmed).toBe(true);
            expect(waitStart).not.toBeNull();
            expect(e.at - waitStart!).toBeGreaterThanOrEqual(W);
          }
        }
      }),
      { numRuns: 2000 },
    );
  });

  it("INV-06 the random generator actually reaches activation (guards against a vacuous property)", () => {
    const samples = fc.sample(sequenceArb, { numRuns: 2000, seed: 42 });
    const activated = samples.filter((evs) =>
      evs.reduce<{ s: LifecycleState; hit: boolean }>(
        (acc, e) => {
          const s = transition(acc.s, e).state;
          return { s, hit: acc.hit || s.phase === "ACTIVATED" };
        },
        { s: confirmed, hit: false },
      ).hit,
    ).length;
    expect(activated).toBeGreaterThan(20);
  });

  it("INV-07 property: owner activity returns every pre-execution state to clean monitoring", () => {
    fc.assert(
      fc.property(sequenceArb, fc.nat(), (events, at) => {
        const s = run(events, confirmed);
        if (!["MONITORING", "WAITING", "ACTIVATED"].includes(s.phase)) return;
        const after = transition(s, { type: "OWNER_ACTIVITY", at }).state;
        expect(after.phase).toBe("MONITORING");
        expect(after.checkinsMissed).toBe(false);
        expect(after.contactConfirmed).toBe(false);
        expect(after.waitingStartedAt).toBeNull();
      }),
      { numRuns: 2000 },
    );
  });

  it("INV-02 execution can only start from an activated plan", () => {
    fc.assert(
      fc.property(sequenceArb, (events) => {
        let s: LifecycleState = confirmed;
        for (const e of events) {
          const before = s;
          s = transition(s, e).state;
          if (s.phase === "EXECUTING" && before.phase !== "EXECUTING") {
            expect(before.phase).toBe("ACTIVATED");
          }
        }
      }),
      { numRuns: 1000 },
    );
  });
});
