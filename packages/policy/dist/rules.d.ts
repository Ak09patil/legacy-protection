/**
 * Hard rules: clear-cut patterns that hold or review a payment regardless of
 * any model. Grounded in FTC and FBI reporting on fraud against older adults
 * (gift cards and phone-initiated imposter scams dominate for ages 70+).
 *
 * Rules are deterministic and versioned (INV-16).
 */
import type { Level, RuleResult } from "./decide.js";
export declare const RULES_VERSION = "rules-1.0.0";
export type TextLabel = "GIFT_CARD_REQUEST" | "CRYPTO_REQUEST" | "URGENCY" | "IMPERSONATION_GOVERNMENT" | "IMPERSONATION_TECH_SUPPORT" | "IMPERSONATION_FAMILY";
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
export declare const RULES: readonly Rule[];
export declare function evaluateRules(f: PaymentFacts): RuleResult;
export {};
