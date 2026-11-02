/**
 * Plan lifecycle state machine. Pure: no I/O, no clocks. Callers pass times in.
 * The Temporal workflow drives this; the rules live here so they can be tested
 * exhaustively and survive a change of orchestrator (ADR-0001).
 *
 * INV-06: activation needs a missed check-in sequence, a passkey-verified
 *         contact confirmation, AND a full waiting period, all since the last
 *         owner activity.
 * INV-07: any owner activity before execution returns to MONITORING and clears
 *         all progress toward activation.
 */
export type Phase = "DRAFT" | "MONITORING" | "WAITING" | "ACTIVATED" | "EXECUTING" | "COMPLETED" | "CANCELLED";
export interface LifecycleState {
    readonly phase: Phase;
    readonly planVersionId: string | null;
    readonly waitingPeriodMs: number;
    readonly checkinsMissed: boolean;
    readonly contactConfirmed: boolean;
    readonly waitingStartedAt: number | null;
}
export type LifecycleEvent = {
    type: "PLAN_CONFIRMED";
    planVersionId: string;
    waitingPeriodMs: number;
    at: number;
} | {
    type: "CHECKIN_SEQUENCE_MISSED";
    at: number;
} | {
    type: "CONTACT_CONFIRMED";
    passkeyVerified: boolean;
    at: number;
} | {
    type: "WAITING_PERIOD_CHECK";
    at: number;
} | {
    type: "OWNER_ACTIVITY";
    at: number;
} | {
    type: "OWNER_CANCELLED";
    at: number;
} | {
    type: "EXECUTION_STARTED";
    at: number;
} | {
    type: "EXECUTION_COMPLETED";
    at: number;
};
export type Effect = {
    type: "NOTIFY_OWNER_ALL_CHANNELS";
    reason: "CONTACT_CONFIRMED" | "WAITING_STARTED" | "ACTIVATED";
} | {
    type: "NOTIFY_CONTACT";
    reason: "ACTIVATION_CANCELLED_BY_OWNER" | "ACTIVATED";
} | {
    type: "SCHEDULE_WAITING_CHECK";
    at: number;
} | {
    type: "REJECTED";
    reason: string;
};
export interface Transition {
    readonly state: LifecycleState;
    readonly effects: readonly Effect[];
}
export declare const MIN_WAITING_PERIOD_MS: number;
export declare const initialState: LifecycleState;
export declare function transition(state: LifecycleState, event: LifecycleEvent): Transition;
export declare function run(events: readonly LifecycleEvent[], from?: LifecycleState): LifecycleState;
