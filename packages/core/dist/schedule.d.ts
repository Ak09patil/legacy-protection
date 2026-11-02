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
export declare const DEFAULT_POLICY: Omit<CheckinPolicy, "timeZone">;
export interface LocalDateTime {
    readonly year: number;
    readonly month: number;
    readonly day: number;
    readonly hour: number;
    readonly minute: number;
}
export declare function toLocal(utcMs: number, timeZone: string): LocalDateTime;
/**
 * Converts a local wall-clock time to a UTC instant. Gap times move forward to
 * the first valid minute; overlap times resolve to the earlier instant.
 */
export declare function fromLocal(l: LocalDateTime, timeZone: string): number;
/** The first check-in due strictly after `afterUtcMs` (e.g. the owner's last check-in). */
export declare function nextDue(afterUtcMs: number, p: CheckinPolicy): number;
export interface CheckinDeadlines {
    readonly dueAt: number;
    readonly reminders: readonly number[];
    readonly missedAt: number;
}
/** Deadlines are absolute durations from the due instant. INV-20 */
export declare function deadlines(dueAt: number, p: CheckinPolicy): CheckinDeadlines;
/** True only when the full window has elapsed in real time without a check-in. */
export declare function isMissed(dueAt: number, lastCheckinAt: number, nowUtcMs: number, p: CheckinPolicy): boolean;
