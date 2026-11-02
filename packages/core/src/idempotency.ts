import { createHash } from "node:crypto";

/**
 * Idempotency keys for money actions. INV-03
 *
 * A key depends only on the confirmed plan version and the step within it.
 * Never on time, attempt number or randomness, so every retry, crash recovery
 * or duplicate workflow run sends the same PayPal-Request-Id and PayPal
 * returns the original result instead of acting twice.
 */
export function moneyActionKey(planVersionId: string, stepId: string): string {
  if (!planVersionId || !stepId) throw new Error("planVersionId and stepId are required");
  const digest = createHash("sha256").update(`${planVersionId}\u0000${stepId}`).digest("hex");
  // PayPal-Request-Id accepts up to 108 characters.
  return `lp-${digest}`;
}

/** Live owner approvals are keyed by the approval record, which is single-use. */
export function approvalActionKey(approvalId: string): string {
  if (!approvalId) throw new Error("approvalId is required");
  return `lp-approval-${createHash("sha256").update(approvalId).digest("hex")}`;
}
