import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { DEFAULT_POLICY, deadlines, fromLocal, isMissed, nextDue, toLocal, type CheckinPolicy } from "../src/schedule.js";

const H = 3_600_000;
const ZONES = [
  "America/New_York",
  "America/Los_Angeles",
  "America/Phoenix", // no DST
  "Europe/London",
  "Australia/Sydney", // southern hemisphere DST
  "Asia/Kolkata", // no DST, half-hour offset
  "Pacific/Chatham", // 45-minute offset with DST
];
const policy = (timeZone: string, over: Partial<CheckinPolicy> = {}): CheckinPolicy => ({
  ...DEFAULT_POLICY,
  timeZone,
  ...over,
});

describe("time zone conversion", () => {
  it("handles the US spring-forward gap by moving to the first valid minute", () => {
    // 2026-03-08 02:30 doesn't exist in New York; 03:00 EDT is the next valid minute.
    const t = fromLocal({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, "America/New_York");
    expect(new Date(t).toISOString()).toBe("2026-03-08T07:00:00.000Z");
  });

  it("picks the earlier instant in the US fall-back overlap", () => {
    // 2026-11-01 01:30 happens twice in New York; the first is EDT (UTC-4).
    const t = fromLocal({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, "America/New_York");
    expect(new Date(t).toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });

  it("round-trips ordinary times exactly", () => {
    fc.assert(
      fc.property(fc.constantFrom(...ZONES), fc.integer({ min: Date.UTC(2025, 0, 1), max: Date.UTC(2030, 0, 1) }), (tz, t) => {
        const minute = Math.floor(t / 60_000) * 60_000;
        expect(fromLocal(toLocal(minute, tz), tz)).toBeLessThanOrEqual(minute);
        expect(toLocal(fromLocal(toLocal(minute, tz), tz), tz)).toEqual(toLocal(minute, tz));
      }),
      { numRuns: 500 },
    );
  });
});

describe("check-in schedule", () => {
  it("is due at the owner's local wall-clock time, across daylight saving", () => {
    // Last check-in Sunday 1 Mar 2026; next due 8 Mar 10:00 New York, the day clocks change.
    const last = Date.UTC(2026, 2, 1, 15, 0);
    const due = nextDue(last, policy("America/New_York"));
    expect(toLocal(due, "America/New_York")).toMatchObject({ month: 3, day: 8, hour: 10, minute: 0 });
    expect(new Date(due).toISOString()).toBe("2026-03-08T14:00:00.000Z"); // EDT, not EST
  });

  it("INV-20 property: DST transitions never cause a missed check-in", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ZONES),
        fc.integer({ min: Date.UTC(2025, 0, 1), max: Date.UTC(2029, 11, 31) }),
        fc.integer({ min: 1, max: 14 }),
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        (tz, last, intervalDays, localHour, localMinute) => {
          const p = policy(tz, { intervalDays, localHour, localMinute });
          const due = nextDue(last, p);
          const d = deadlines(due, p);

          // Due in the future, roughly intervalDays later (DST shifts by at most an hour).
          expect(due).toBeGreaterThan(last);
          expect(due - last).toBeLessThanOrEqual((intervalDays + 1) * 24 * H + H);

          // The owner always gets the full window, in real elapsed time.
          expect(d.missedAt - d.dueAt).toBe(p.missedAfterMs);
          for (const r of d.reminders) expect(r).toBeLessThan(d.missedAt);

          // Never missed one millisecond before the full window has elapsed.
          expect(isMissed(due, last, d.missedAt - 1, p)).toBe(false);
          expect(isMissed(due, last, d.missedAt, p)).toBe(true);

          // Checking in at any point after the due time clears it.
          expect(isMissed(due, due, d.missedAt + 10 * H, p)).toBe(false);
        },
      ),
      { numRuns: 3000 },
    );
  });

  it("INV-20 the due time is the requested local time unless that time doesn't exist that day", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ZONES),
        fc.integer({ min: Date.UTC(2025, 0, 1), max: Date.UTC(2029, 11, 31) }),
        fc.integer({ min: 0, max: 23 }),
        (tz, last, localHour) => {
          const p = policy(tz, { localHour, localMinute: 30 });
          const local = toLocal(nextDue(last, p), tz);
          const exact = local.hour === localHour && local.minute === 30;
          // Only allowed difference: pushed forward out of a spring-forward gap, within 2 hours.
          const shiftedMinutes = (local.hour * 60 + local.minute) - (localHour * 60 + 30);
          expect(exact || (shiftedMinutes > 0 && shiftedMinutes <= 120)).toBe(true);
        },
      ),
      { numRuns: 3000 },
    );
  });
});
