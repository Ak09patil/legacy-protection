/**
 * The policy engine's final word on a payment.
 *
 * INV-10: fail closed. Missing or invalid model output means HOLD.
 * INV-11: models only add caution. Final = max(rules, model).
 * INV-12: every REVIEW or HOLD carries at least one readable reason.
 * INV-14: network-only signals on a registered caregiver cap at REVIEW.
 * INV-16: the decision records the versions that produced it.
 */
export const LEVELS = ["PASS", "REVIEW", "HOLD"];
const rank = { PASS: 0, REVIEW: 1, HOLD: 2 };
export function maxLevel(a, b) {
    return rank[a] >= rank[b] ? a : b;
}
export function minLevel(a, b) {
    return rank[a] <= rank[b] ? a : b;
}
const DEPENDENCY_UNAVAILABLE = {
    code: "DEPENDENCY_UNAVAILABLE",
    text: "We couldn't finish checking this payment, so we've paused it to be safe.",
    source: "SYSTEM",
};
function signalIsValid(s) {
    return LEVELS.includes(s.level) && (s.level === "PASS" || s.reasons.length > 0);
}
export function decide(rules, model, ctx) {
    const base = { policyVersion: ctx.policyVersion, planVersionId: ctx.planVersionId };
    // INV-10
    if (model.status !== "OK" || !model.signals.every(signalIsValid)) {
        return {
            ...base,
            level: "HOLD",
            reasons: [...rules.reasons, DEPENDENCY_UNAVAILABLE],
            modelVersions: model.status === "OK" ? model.signals.map((s) => s.modelVersion) : [],
        };
    }
    let level = rules.level;
    const reasons = [...rules.reasons];
    for (const s of model.signals) {
        // INV-14
        const effective = s.networkOnly && ctx.payeeIsRegisteredCaregiver ? minLevel(s.level, "REVIEW") : s.level;
        // INV-11
        level = maxLevel(level, effective);
        if (effective !== "PASS")
            reasons.push(...s.reasons);
    }
    // INV-12
    if (level !== "PASS" && reasons.length === 0) {
        reasons.push({
            code: "UNEXPLAINED",
            text: "This payment needs a second look before it goes out.",
            source: "SYSTEM",
        });
    }
    return { ...base, level, reasons, modelVersions: model.signals.map((s) => s.modelVersion) };
}
