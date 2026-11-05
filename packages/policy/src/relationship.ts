/**
 * Slow scams: investment ("pig butchering") and romance scams.
 *
 * These don't look like scams on any single payment. The scammer builds trust
 * for weeks, takes a small first payment, then asks for more and more, often
 * through several accounts, and finally asks for a "fee" or "tax" to release
 * money that never existed. So we look at the whole relationship, not the one
 * payment:
 *
 *   1. Escalation: a recent payee being paid much more than at first.
 *   2. Total: how much has gone to one recent payee, against the owner's own
 *      normal spending (with a floor, so it works from day one).
 *   3. Spread: how much has gone to all recent payees together, so moving the
 *      victim to a new account each time doesn't reset anything.
 *   4. Words: investment returns, "withdrawal fees", and romance with a money
 *      request, in every language we offer.
 *
 * Payments that are still waiting (paused, scheduled) count towards the
 * totals, so queueing several at once can't slip under a threshold. Everything
 * here is a pure function of the owner's own history (INV-27).
 */

export const RELATIONSHIP_POLICY = {
  /** A payee first paid within this many days is a "recent" relationship. */
  recentDays: 180,
  /** Escalation: the new amount is at least this many times the first payment… */
  escalationOverFirst: 2,
  /** …and at least this many times the median of earlier payments to them. */
  escalationOverMedian: 1.5,
  /** Total to one recent payee before we pause: the larger of this floor and the owner's typical month. */
  payeeTotalFloorMinor: 250_000, // $2,500
  payeeTotalMonths: 1,
  /** Total to all recent payees in 30 days before we pause: the larger of this floor and two typical months. */
  spreadFloorMinor: 500_000, // $5,000
  spreadMonths: 2,
  spreadDays: 30,
  /** Payments to one payee within ±10% of each other, about monthly, look like a bill, not a scam. */
  steadyTolerance: 0.1,
  steadyMinGapDays: 25,
} as const;

export interface HistoryPayment {
  readonly payeeId: string;
  readonly amountMinor: number;
  readonly at: Date;
}

export interface RelationshipFacts {
  /** True if this payee was first paid within the recent window (and isn't brand new). */
  readonly recentPayee: boolean;
  readonly priorPaymentsToPayee: number;
  readonly firstAmountMinor: number | null;
  readonly priorMedianMinor: number | null;
  /** Everything sent or waiting to go to this payee in the recent window, including this payment. */
  readonly payeeTotalMinor: number;
  /** Everything sent or waiting to go to any recent or new payee in the last 30 days, including this payment. */
  readonly spreadTotalMinor: number;
  /** The owner's typical monthly spending with established payees, or null when we can't tell yet. */
  readonly baselineMonthlyMinor: number | null;
  /** Payments to this payee look like a regular bill (steady amount, about monthly). */
  readonly looksLikeABill: boolean;
}

const median = (xs: readonly number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

const DAY = 86_400_000;

/**
 * @param sent     payments that have left the account (sent or released)
 * @param waiting  payments not yet sent but not stopped (paused, scheduled, awaiting confirmation)
 */
export function relationshipFacts(
  sent: readonly HistoryPayment[],
  waiting: readonly HistoryPayment[],
  payeeId: string,
  amountMinor: number,
  now: Date,
): RelationshipFacts {
  const P = RELATIONSHIP_POLICY;
  const firstPaid = new Map<string, number>();
  for (const h of sent) {
    const t = h.at.getTime();
    if (!firstPaid.has(h.payeeId) || t < firstPaid.get(h.payeeId)!) firstPaid.set(h.payeeId, t);
  }
  const isRecent = (id: string) => {
    const f = firstPaid.get(id);
    return f === undefined || now.getTime() - f <= P.recentDays * DAY; // never paid counts as recent
  };
  const recentCutoff = now.getTime() - P.recentDays * DAY;

  const toPayee = sent.filter((h) => h.payeeId === payeeId).sort((a, b) => a.at.getTime() - b.at.getTime());
  const waitingToPayee = waiting.filter((h) => h.payeeId === payeeId);
  const recentPayee = toPayee.length > 0 && isRecent(payeeId);

  const payeeTotalMinor =
    [...toPayee, ...waitingToPayee].filter((h) => h.at.getTime() >= recentCutoff).reduce((a, h) => a + h.amountMinor, 0) + amountMinor;

  const spreadCutoff = now.getTime() - P.spreadDays * DAY;
  const spreadTotalMinor =
    [...sent, ...waiting].filter((h) => h.at.getTime() >= spreadCutoff && isRecent(h.payeeId)).reduce((a, h) => a + h.amountMinor, 0) +
    (isRecent(payeeId) ? amountMinor : 0);

  // Baseline: monthly spending with established payees over the last 180 days,
  // once the owner has at least 60 days of history. Recent payees are left out,
  // so a scam that has already started can't raise its own threshold.
  const oldest = sent.reduce((m, h) => Math.min(m, h.at.getTime()), Infinity);
  let baselineMonthlyMinor: number | null = null;
  if (Number.isFinite(oldest) && now.getTime() - oldest >= 60 * DAY) {
    const windowStart = Math.max(oldest, now.getTime() - 180 * DAY);
    const months = Math.max(1, (now.getTime() - windowStart) / (30 * DAY));
    const established = sent.filter((h) => h.at.getTime() >= windowStart && !isRecent(h.payeeId)).reduce((a, h) => a + h.amountMinor, 0);
    baselineMonthlyMinor = Math.round(established / months);
  }

  const amounts = [...toPayee.map((h) => h.amountMinor), amountMinor];
  const lo = Math.min(...amounts);
  const hi = Math.max(...amounts);
  const gaps = toPayee.map((h, i) => (i === 0 ? null : (h.at.getTime() - toPayee[i - 1]!.at.getTime()) / DAY)).filter((g): g is number => g !== null);
  const lastGap = toPayee.length ? (now.getTime() - toPayee.at(-1)!.at.getTime()) / DAY : 0;
  const looksLikeABill =
    toPayee.length >= 1 && hi <= lo * (1 + P.steadyTolerance) && [...gaps, lastGap].every((g) => g >= P.steadyMinGapDays);

  return {
    recentPayee,
    priorPaymentsToPayee: toPayee.length,
    firstAmountMinor: toPayee[0]?.amountMinor ?? null,
    priorMedianMinor: median(toPayee.map((h) => h.amountMinor)),
    payeeTotalMinor,
    spreadTotalMinor,
    baselineMonthlyMinor,
    looksLikeABill,
  };
}

export const payeeTotalThreshold = (f: RelationshipFacts) =>
  Math.max(RELATIONSHIP_POLICY.payeeTotalFloorMinor, (f.baselineMonthlyMinor ?? 0) * RELATIONSHIP_POLICY.payeeTotalMonths);

export const spreadThreshold = (f: RelationshipFacts) =>
  Math.max(RELATIONSHIP_POLICY.spreadFloorMinor, (f.baselineMonthlyMinor ?? 0) * RELATIONSHIP_POLICY.spreadMonths);

export function isEscalating(f: RelationshipFacts, amountMinor: number): boolean {
  const P = RELATIONSHIP_POLICY;
  return (
    f.recentPayee &&
    f.priorPaymentsToPayee >= 1 &&
    f.firstAmountMinor !== null &&
    f.priorMedianMinor !== null &&
    amountMinor >= f.firstAmountMinor * P.escalationOverFirst &&
    amountMinor >= f.priorMedianMinor * P.escalationOverMedian
  );
}

/** Facts when there's no history to look at: nothing recent, nothing escalating, totals of just this payment. */
export function noRelationship(amountMinor: number): RelationshipFacts {
  return {
    recentPayee: false,
    priorPaymentsToPayee: 0,
    firstAmountMinor: null,
    priorMedianMinor: null,
    payeeTotalMinor: amountMinor,
    spreadTotalMinor: amountMinor,
    baselineMonthlyMinor: null,
    looksLikeABill: false,
  };
}
