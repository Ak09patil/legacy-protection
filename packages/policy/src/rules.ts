/**
 * Hard rules: clear-cut patterns that hold or review a payment regardless of
 * any model. Grounded in FTC and FBI reporting on fraud against older adults
 * (gift cards and phone-initiated imposter scams dominate for ages 70+).
 *
 * Rules are deterministic and versioned (INV-16).
 */

import type { Level, Reason, RuleResult } from "./decide.js";
import { maxLevel } from "./decide.js";

export const RULES_VERSION = "rules-1.0.0";

export type TextLabel =
  | "GIFT_CARD_REQUEST"
  | "CRYPTO_REQUEST"
  | "URGENCY"
  | "IMPERSONATION_GOVERNMENT"
  | "IMPERSONATION_TECH_SUPPORT"
  | "IMPERSONATION_FAMILY";

export interface PaymentFacts {
  readonly payeeIsNew: boolean;
  readonly payeeIsRegisteredCaregiver: boolean;
  /** Amount divided by the owner's typical payment (median of history). */
  readonly amountRatioToTypical: number | null;
  readonly textLabels: readonly TextLabel[];
  readonly withinRegisteredObligationCap: boolean;
}

interface Rule {
  readonly code: string;
  readonly level: Level;
  readonly text: string;
  readonly applies: (f: PaymentFacts) => boolean;
}

const has = (f: PaymentFacts, l: TextLabel) => f.textLabels.includes(l);

export const RULES: readonly Rule[] = [
  {
    code: "NEW_PAYEE_GIFT_CARD_OR_CRYPTO",
    level: "HOLD",
    text: "This is a new payee asking for gift cards or cryptocurrency. Real companies and government offices don't ask for payment this way.",
    applies: (f) => f.payeeIsNew && (has(f, "GIFT_CARD_REQUEST") || has(f, "CRYPTO_REQUEST")),
  },
  {
    code: "NEW_PAYEE_IMPERSONATION_URGENT",
    level: "HOLD",
    text: "This new payee claims to be from a government office or tech support and says it's urgent. That's a common scam pattern.",
    applies: (f) =>
      f.payeeIsNew &&
      has(f, "URGENCY") &&
      (has(f, "IMPERSONATION_GOVERNMENT") || has(f, "IMPERSONATION_TECH_SUPPORT")),
  },
  {
    code: "FAMILY_EMERGENCY_NEW_PAYEE",
    level: "HOLD",
    text: "Someone new says they're family and needs money urgently. Please confirm by calling them on a number you already know.",
    applies: (f) => f.payeeIsNew && has(f, "IMPERSONATION_FAMILY") && has(f, "URGENCY"),
  },
  {
    code: "NEW_PAYEE_UNUSUALLY_LARGE",
    level: "REVIEW",
    text: "This payment to a new payee is much larger than your usual payments.",
    applies: (f) => f.payeeIsNew && f.amountRatioToTypical !== null && f.amountRatioToTypical >= 5,
  },
  {
    code: "CAREGIVER_OVER_CAP",
    level: "REVIEW",
    text: "This payment to your registered caregiver is above the amount you set in your plan.",
    applies: (f) => f.payeeIsRegisteredCaregiver && !f.withinRegisteredObligationCap,
  },
];

export function evaluateRules(f: PaymentFacts): RuleResult {
  let level: Level = "PASS";
  const reasons: Reason[] = [];
  for (const r of RULES) {
    if (r.applies(f)) {
      level = maxLevel(level, r.level);
      reasons.push({ code: r.code, text: r.text, source: "RULE" });
    }
  }
  return { level, reasons };
}
