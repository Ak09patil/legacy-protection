/**
 * Check-in scheduling in the owner's own time zone. INV-20.
 *
 * - Check-ins are due at a wall-clock time in the owner's IANA time zone
 *   ("every 7 days at 10:00 in America/New_York").
 * - Deadlines (reminders, "missed") are measured in absolute elapsed time
 *   from the due instant, so a daylight-saving change can never shorten the
 *   owner's window to respond.
 * - A wall-clock time that doesn't exist (spring-forward gap) moves to the
 *   first valid minute after it; an ambiguous one (fall-back overlap) uses the
 *   earlier instant.
 *
 * Uses only Intl, no date libraries. Timestamps are UTC milliseconds.
 */

export interface CheckinPolicy {
  readonly timeZone: string;
  readonly intervalDays: number;
  readonly localHour: number;
  readonly localMinute: number;
  /** Absolute durations after the due instant. */
  readonly reminderAfterMs: readonly number[];
  readonly missedAfterMs: number;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const DEFAULT_POLICY: Omit<CheckinPolicy, "timeZone"> = {
  intervalDays: 7,
  localHour: 10,
  localMinute: 0,
  reminderAfterMs: [24 * HOUR, 48 * HOUR],
  missedAfterMs: 72 * HOUR,
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export interface LocalDateTime {
  readonly year: number;
  readonly month: number; // 1-12
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

export function toLocal(utcMs: number, timeZone: string): LocalDateTime {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(new Date(utcMs))
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  return { year: parts.year!, month: parts.month!, day: parts.day!, hour: parts.hour!, minute: parts.minute! };
}

/** Offset of the zone from UTC at an instant, in ms. */
function offsetAt(utcMs: number, timeZone: string): number {
  const l = toLocal(utcMs, timeZone);
  const asUtc = Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute);
  return asUtc - Math.floor(utcMs / 60_000) * 60_000;
}

/**
 * Converts a local wall-clock time to a UTC instant. Gap times move forward to
 * the first valid minute; overlap times resolve to the earlier instant.
 */
export function fromLocal(l: LocalDateTime, timeZone: string): number {
  const naive = Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute);
  // Wall-clock time that doesn't exist (spring forward): use the first valid minute after it.
  for (let shift = 0; shift <= 3 * 60; shift++) {
    const t = resolveExact(naive + shift * 60_000, timeZone);
    if (t !== null) return t;
  }
  throw new Error(`Cannot resolve local time in ${timeZone}`);
}

/** Instants whose wall-clock time is exactly `naiveLocal`; the earliest, or null if none (a gap). */
function resolveExact(naiveLocal: number, timeZone: string): number | null {
  // The offset in force must be one of those seen a day either side.
  const offsets = new Set([offsetAt(naiveLocal - DAY, timeZone), offsetAt(naiveLocal + DAY, timeZone)]);
  const matches = [...offsets]
    .map((off) => naiveLocal - off)
    .filter((t) => offsetAt(t, timeZone) === naiveLocal - t);
  return matches.length ? Math.min(...matches) : null;
}

function addLocalDays(l: LocalDateTime, days: number): LocalDateTime {
  const d = new Date(Date.UTC(l.year, l.month - 1, l.day + days));
  return { ...l, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** The first check-in due strictly after `afterUtcMs` (e.g. the owner's last check-in). */
export function nextDue(afterUtcMs: number, p: CheckinPolicy): number {
  const base = toLocal(afterUtcMs, p.timeZone);
  const target: LocalDateTime = { ...addLocalDays(base, p.intervalDays), hour: p.localHour, minute: p.localMinute };
  return fromLocal(target, p.timeZone);
}

export interface CheckinDeadlines {
  readonly dueAt: number;
  readonly reminders: readonly number[];
  readonly missedAt: number;
}

/** Deadlines are absolute durations from the due instant. INV-20 */
export function deadlines(dueAt: number, p: CheckinPolicy): CheckinDeadlines {
  return {
    dueAt,
    reminders: p.reminderAfterMs.map((d) => dueAt + d),
    missedAt: dueAt + p.missedAfterMs,
  };
}

/** True only when the full window has elapsed in real time without a check-in. */
export function isMissed(dueAt: number, lastCheckinAt: number, nowUtcMs: number, p: CheckinPolicy): boolean {
  if (lastCheckinAt >= dueAt) return false;
  return nowUtcMs >= deadlines(dueAt, p).missedAt;
}
