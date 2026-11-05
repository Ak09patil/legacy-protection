/**
 * Hard rules: clear-cut patterns that hold or review a payment regardless of
 * any model. Grounded in FTC and FBI reporting on fraud against older adults
 * (gift cards and phone-initiated imposter scams dominate for ages 70+).
 *
 * Rules are deterministic and versioned (INV-16).
 */

import type { Level, Reason, RuleResult } from "./decide.js";
import { maxLevel } from "./decide.js";
import { isEscalating, payeeTotalThreshold, spreadThreshold, type RelationshipFacts } from "./relationship.js";

export const RULES_VERSION = "rules-1.2.0";

export type TextLabel =
  | "GIFT_CARD_REQUEST"
  | "CRYPTO_REQUEST"
  | "URGENCY"
  | "IMPERSONATION_GOVERNMENT"
  | "IMPERSONATION_TECH_SUPPORT"
  | "IMPERSONATION_FAMILY"
  /** Promised returns, trading platforms, "your profit is ready". */
  | "INVESTMENT_PITCH"
  /** A fee, tax or deposit to release money: always a scam. */
  | "WITHDRAWAL_FEE"
  /** Affection from someone the owner pays: "my love", "can't wait to meet you". */
  | "ROMANCE";


export interface PaymentFacts {
  readonly payeeIsNew: boolean;
  readonly payeeIsRegisteredCaregiver: boolean;
  /** Amount divided by the owner's typical payment (median of history). */
  readonly amountRatioToTypical: number | null;
  readonly textLabels: readonly TextLabel[];
  readonly withinRegisteredObligationCap: boolean;
  /** This payment's amount, and how it fits the owner's relationship with this payee (INV-27). */
  readonly amountMinor?: number;
  readonly relationship?: RelationshipFacts;
  /** What people have told us about this payee: other households (counted once each) and the owner herself (INV-28). */
  readonly scamReports?: { readonly otherHouseholds: number; readonly byOwner: boolean };
}

interface Rule {
  readonly code: string;
  readonly level: Level;
  readonly text: string;
  readonly applies: (f: PaymentFacts) => boolean;
}

const has = (f: PaymentFacts, l: TextLabel) => f.textLabels.includes(l);
/** New, or first paid within the recent window. Registered carers are covered by their own cap instead. */
const youngRelationship = (f: PaymentFacts) => !f.payeeIsRegisteredCaregiver && (f.payeeIsNew || (f.relationship?.recentPayee ?? false));
const OTHER_SCAM_LABELS: readonly TextLabel[] = ["GIFT_CARD_REQUEST", "CRYPTO_REQUEST", "URGENCY", "IMPERSONATION_GOVERNMENT", "IMPERSONATION_TECH_SUPPORT", "IMPERSONATION_FAMILY", "INVESTMENT_PITCH", "WITHDRAWAL_FEE"];

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
  // ---- Slow scams: investment and romance (INV-27) ----
  {
    code: "WITHDRAWAL_FEE",
    level: "HOLD",
    text: "You're being asked to pay a fee or tax to get money back. Real investments never ask for this. It's how these scams take the last payment.",
    applies: (f) => !f.payeeIsRegisteredCaregiver && has(f, "WITHDRAWAL_FEE"),
  },
  {
    code: "INVESTMENT_PITCH_RECENT_PAYEE",
    level: "HOLD",
    text: "Someone you met recently is offering an investment or profits. This is the most costly scam for people over 60.",
    applies: (f) => youngRelationship(f) && has(f, "INVESTMENT_PITCH"),
  },
  {
    code: "ROMANCE_MONEY_REQUEST",
    level: "HOLD",
    text: "Someone you met recently who speaks of love is asking for money for an emergency, travel or an investment. That is how romance scams work.",
    applies: (f) => youngRelationship(f) && has(f, "ROMANCE") && OTHER_SCAM_LABELS.some((l) => has(f, l)),
  },
  {
    code: "ROMANCE_RECENT_PAYEE",
    level: "REVIEW",
    text: "Someone you met recently speaks of love and is being sent money. Have you met them in person?",
    applies: (f) => youngRelationship(f) && has(f, "ROMANCE"),
  },
  {
    code: "RECENT_PAYEE_ESCALATING",
    level: "REVIEW",
    text: "You started paying this person recently, and this is much more than before. Slow scams grow like this.",
    applies: (f) => !f.payeeIsRegisteredCaregiver && !!f.relationship && f.amountMinor !== undefined && isEscalating(f.relationship, f.amountMinor),
  },
  {
    code: "RECENT_PAYEE_LARGE_TOTAL",
    level: "HOLD",
    text: "A lot of money has now gone to someone you started paying recently, more than you usually spend in a month.",
    applies: (f) =>
      !f.payeeIsRegisteredCaregiver &&
      !!f.relationship &&
      f.relationship.recentPayee &&
      !f.relationship.looksLikeABill &&
      f.relationship.payeeTotalMinor >= payeeTotalThreshold(f.relationship),
  },
  {
    code: "RECENT_PAYEE_LARGE_TOTAL_BILL",
    level: "REVIEW",
    text: "A lot of money has now gone to someone you started paying recently. It looks like a regular bill; please check it is.",
    applies: (f) =>
      !f.payeeIsRegisteredCaregiver &&
      !!f.relationship &&
      f.relationship.recentPayee &&
      f.relationship.looksLikeABill &&
      f.relationship.payeeTotalMinor >= payeeTotalThreshold(f.relationship),
  },
  {
    code: "NEW_PAYEES_SPREAD",
    level: "HOLD",
    text: "A lot of money has gone to several new people in the last month. Scammers often ask you to pay a different account each time.",
    applies: (f) => youngRelationship(f) && !!f.relationship && f.relationship.spreadTotalMinor >= spreadThreshold(f.relationship),
  },
  // ---- What people told us: learned the same day, no retraining (INV-28) ----
  {
    code: "PAYEE_YOU_REPORTED",
    level: "HOLD",
    text: "You told us before that this person scammed you.",
    applies: (f) => f.scamReports?.byOwner === true,
  },
  {
    code: "PAYEE_REPORTED_BY_OTHERS",
    level: "HOLD",
    text: "Other people have told us this person scammed them.",
    applies: (f) => !f.payeeIsRegisteredCaregiver && (f.scamReports?.otherHouseholds ?? 0) >= 2,
  },
  {
    code: "PAYEE_REPORTED_ONCE",
    level: "REVIEW",
    text: "Someone else has told us this person may have scammed them.",
    // One report only asks, and a carer you registered is only ever asked about: one person can't get someone blocked.
    applies: (f) => (f.scamReports?.otherHouseholds ?? 0) === 1 || (f.payeeIsRegisteredCaregiver && (f.scamReports?.otherHouseholds ?? 0) >= 2),
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
