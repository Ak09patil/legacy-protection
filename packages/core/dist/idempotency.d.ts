/**
 * Idempotency keys for money actions. INV-03
 *
 * A key depends only on the confirmed plan version and the step within it.
 * Never on time, attempt number or randomness, so every retry, crash recovery
 * or duplicate workflow run sends the same PayPal-Request-Id and PayPal
 * returns the original result instead of acting twice.
 */
export declare function moneyActionKey(planVersionId: string, stepId: string): string;
/** Live owner approvals are keyed by the approval record, which is single-use. */
export declare function approvalActionKey(approvalId: string): string;
