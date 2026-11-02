/**
 * The policy engine's final word on a payment.
 *
 * INV-10: fail closed. Missing or invalid model output means HOLD.
 * INV-11: models only add caution. Final = max(rules, model).
 * INV-12: every REVIEW or HOLD carries at least one readable reason.
 * INV-14: network-only signals on a registered caregiver cap at REVIEW.
 * INV-16: the decision records the versions that produced it.
 */

export const LEVELS = ["PASS", "REVIEW", "HOLD"] as const;
export type Level = (typeof LEVELS)[number];

const rank: Record<Level, number> = { PASS: 0, REVIEW: 1, HOLD: 2 };

export function maxLevel(a: Level, b: Level): Level {
  return rank[a] >= rank[b] ? a : b;
}

export function minLevel(a: Level, b: Level): Level {
  return rank[a] <= rank[b] ? a : b;
}

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

export type ModelOutcome =
  | { readonly status: "OK"; readonly signals: readonly ModelSignal[] }
  | { readonly status: "UNAVAILABLE"; readonly detail: string };

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

const DEPENDENCY_UNAVAILABLE: Reason = {
  code: "DEPENDENCY_UNAVAILABLE",
  text: "We couldn't finish checking this payment, so we've paused it to be safe.",
  source: "SYSTEM",
};

function signalIsValid(s: ModelSignal): boolean {
  return LEVELS.includes(s.level) && (s.level === "PASS" || s.reasons.length > 0);
}

export function decide(rules: RuleResult, model: ModelOutcome, ctx: DecisionContext): Decision {
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

  let level: Level = rules.level;
  const reasons: Reason[] = [...rules.reasons];

  for (const s of model.signals) {
    // INV-14
    const effective =
      s.networkOnly && ctx.payeeIsRegisteredCaregiver ? minLevel(s.level, "REVIEW") : s.level;
    // INV-11
    level = maxLevel(level, effective);
    if (effective !== "PASS") reasons.push(...s.reasons);
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
