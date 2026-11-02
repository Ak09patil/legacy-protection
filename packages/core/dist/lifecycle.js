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
export const MIN_WAITING_PERIOD_MS = 72 * 60 * 60 * 1000; // 72 hours
export const initialState = {
    phase: "DRAFT",
    planVersionId: null,
    waitingPeriodMs: MIN_WAITING_PERIOD_MS,
    checkinsMissed: false,
    contactConfirmed: false,
    waitingStartedAt: null,
};
const PRE_EXECUTION = new Set(["MONITORING", "WAITING", "ACTIVATED"]);
function reject(state, reason) {
    return { state, effects: [{ type: "REJECTED", reason }] };
}
function cleared(state) {
    return { ...state, phase: "MONITORING", checkinsMissed: false, contactConfirmed: false, waitingStartedAt: null };
}
function maybeStartWaiting(s, at, effects) {
    if (s.phase === "MONITORING" && s.checkinsMissed && s.contactConfirmed) {
        effects.push({ type: "NOTIFY_OWNER_ALL_CHANNELS", reason: "WAITING_STARTED" });
        effects.push({ type: "SCHEDULE_WAITING_CHECK", at: at + s.waitingPeriodMs });
        return { ...s, phase: "WAITING", waitingStartedAt: at };
    }
    return s;
}
export function transition(state, event) {
    const effects = [];
    switch (event.type) {
        case "PLAN_CONFIRMED": {
            if (state.phase !== "DRAFT" && state.phase !== "MONITORING") {
                return reject(state, `Cannot confirm a plan in phase ${state.phase}`);
            }
            if (event.waitingPeriodMs < MIN_WAITING_PERIOD_MS) {
                return reject(state, "Waiting period is below the minimum");
            }
            // A new confirmed version restarts monitoring from a clean slate.
            return {
                state: {
                    ...cleared(state),
                    planVersionId: event.planVersionId,
                    waitingPeriodMs: event.waitingPeriodMs,
                },
                effects,
            };
        }
        case "OWNER_ACTIVITY": {
            // INV-07
            if (!PRE_EXECUTION.has(state.phase))
                return { state, effects };
            const wasProgressing = state.phase !== "MONITORING" || state.checkinsMissed || state.contactConfirmed;
            if (wasProgressing && state.contactConfirmed) {
                effects.push({ type: "NOTIFY_CONTACT", reason: "ACTIVATION_CANCELLED_BY_OWNER" });
            }
            return { state: cleared(state), effects };
        }
        case "OWNER_CANCELLED": {
            if (!PRE_EXECUTION.has(state.phase) && state.phase !== "DRAFT") {
                return reject(state, `Cannot cancel in phase ${state.phase}`);
            }
            return { state: { ...state, phase: "CANCELLED" }, effects };
        }
        case "CHECKIN_SEQUENCE_MISSED": {
            if (state.phase !== "MONITORING")
                return { state, effects };
            const s = maybeStartWaiting({ ...state, checkinsMissed: true }, event.at, effects);
            return { state: s, effects };
        }
        case "CONTACT_CONFIRMED": {
            if (state.phase !== "MONITORING")
                return { state, effects };
            if (!event.passkeyVerified)
                return reject(state, "Contact confirmation requires a verified passkey");
            // The owner hears about it immediately, on every channel (THREAT_MODEL T1).
            effects.push({ type: "NOTIFY_OWNER_ALL_CHANNELS", reason: "CONTACT_CONFIRMED" });
            const s = maybeStartWaiting({ ...state, contactConfirmed: true }, event.at, effects);
            return { state: s, effects };
        }
        case "WAITING_PERIOD_CHECK": {
            if (state.phase !== "WAITING" || state.waitingStartedAt === null)
                return { state, effects };
            if (event.at - state.waitingStartedAt < state.waitingPeriodMs)
                return { state, effects };
            effects.push({ type: "NOTIFY_OWNER_ALL_CHANNELS", reason: "ACTIVATED" });
            effects.push({ type: "NOTIFY_CONTACT", reason: "ACTIVATED" });
            return { state: { ...state, phase: "ACTIVATED" }, effects };
        }
        case "EXECUTION_STARTED": {
            if (state.phase !== "ACTIVATED")
                return reject(state, "Execution requires an activated plan");
            return { state: { ...state, phase: "EXECUTING" }, effects };
        }
        case "EXECUTION_COMPLETED": {
            if (state.phase !== "EXECUTING")
                return reject(state, "Nothing is executing");
            return { state: { ...state, phase: "COMPLETED" }, effects };
        }
    }
}
export function run(events, from = initialState) {
    return events.reduce((s, e) => transition(s, e).state, from);
}
