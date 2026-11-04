/**
 * Deterministic scam-language labeller. Used when no AI model is configured,
 * and alongside the model as a floor: a phrase that matches here is always
 * labelled, whatever the model says (models can only add caution, INV-11).
 */

import type { TextLabel } from "./rules.js";

const PATTERNS: ReadonlyArray<[TextLabel, RegExp]> = [
  ["GIFT_CARD_REQUEST", /\b(gift ?cards?|itunes|apple card|google play card|steam card|amazon card|vouchers?)\b/i],
  ["CRYPTO_REQUEST", /\b(bitcoin|btc|crypto(currency)?|usdt|tether|ethereum|eth wallet|bitcoin atm|wallet address)\b/i],
  ["URGENCY", /\b(urgent(ly)?|immediately|right now|today|within (the )?(hour|24 hours)|asap|don'?t tell|before it'?s too late|final notice|last chance)\b/i],
  ["IMPERSONATION_GOVERNMENT", /\b(irs|social security|ssa|medicare|police|sheriff|warrant|arrest|tax (office|debt)|customs|court|federal agent|fbi)\b/i],
  ["IMPERSONATION_TECH_SUPPORT", /\b(tech(nical)? support|microsoft|apple support|virus|hacked|refund department|account (is )?(locked|suspended|compromised)|unlock your account|remote access)\b/i],
  ["IMPERSONATION_FAMILY", /\b(grandma|grandpa|it'?s me|your (grandson|granddaughter|nephew|niece)|i'?m in (jail|trouble|hospital)|bail|lost my phone|new number)\b/i],
];

export function keywordLabels(text: string): TextLabel[] {
  const t = text.slice(0, 2000);
  return PATTERNS.filter(([, re]) => re.test(t)).map(([label]) => label);
}
