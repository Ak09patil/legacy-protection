/**
 * The policy engine's final word on a payment.
 *
 * INV-10: fail closed. Missing or invalid model output means HOLD.
 * INV-11: models only add caution. Final = max(rules, model).
 * INV-12: every REVIEW or HOLD carries at least one readable reason.
 * INV-14: network-only signals on a registered caregiver cap at REVIEW.
 * INV-16: the decision records the versions that produced it.
 */
export declare const LEVELS: readonly ["PASS", "REVIEW", "HOLD"];
export type Level = (typeof LEVELS)[number];
export declare function maxLevel(a: Level, b: Level): Level;
export declare function minLevel(a: Level, b: Level): Level;
export interface Reason {
    readonly code: string;
    readonly text: string;
    readonly source: "RULE" | "MODEL" | "NETWORK" | "SYSTEM";
}
export interface RuleResult {
    readonly level: Level;
    readonly reasons: readonly Reason[];
}
export interface ModelSignal {
    readonly level: Level;
    readonly reasons: readonly Reason[];
    /** True when the signal comes only from cross-account network patterns. */
    readonly networkOnly: boolean;
    readonly modelVersion: string;
}
export type ModelOutcome = {
    readonly status: "OK";
    readonly signals: readonly ModelSignal[];
} | {
    readonly status: "UNAVAILABLE";
    readonly detail: string;
};
export interface DecisionContext {
    readonly payeeIsRegisteredCaregiver: boolean;
    readonly policyVersion: string;
    readonly planVersionId: string | null;
}
export interface Decision {
    readonly level: Level;
    readonly reasons: readonly Reason[];
    readonly policyVersion: string;
    readonly modelVersions: readonly string[];
    readonly planVersionId: string | null;
}
export declare function decide(rules: RuleResult, model: ModelOutcome, ctx: DecisionContext): Decision;
