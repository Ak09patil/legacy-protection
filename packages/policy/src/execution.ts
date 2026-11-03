/**
 * Turns an activated plan into the exact list of steps the executor may run.
 * The executor runs only these steps; nothing a model says can add to them.
 *
 * INV-02: steps come only from the confirmed plan version.
 * INV-04: no step ever sends the balance anywhere. Payments are limited to
 *         registered household employees, within the owner's caps and time
 *         limit.
 */

import type { Obligation, PlanDocument } from "./plan.js";

export type ExecutionStep =
  | { readonly id: string; readonly type: "CANCEL_SUBSCRIPTION"; readonly subscriptionId: string }
  | { readonly id: string; readonly type: "CANCEL_INVOICE"; readonly invoiceId: string }
  | {
      readonly id: string;
      readonly type: "PAY_OBLIGATION";
      readonly obligationId: string;
      readonly payeeEmail: string;
      readonly amountMinor: number;
      readonly currency: string;
      readonly dueAt: number;
    }
  | { readonly id: string; readonly type: "ASSEMBLE_EXECUTOR_PACKAGE" };

export interface AccountSnapshot {
  readonly activeSubscriptionIds: readonly string[];
  readonly openInvoiceIds: readonly string[];
}

const DAY = 86_400_000;
const CADENCE_DAYS: Record<Obligation["cadence"], number> = { WEEKLY: 7, BIWEEKLY: 14, MONTHLY: 30 };

export function planExecution(plan: PlanDocument, account: AccountSnapshot, activatedAt: number): ExecutionStep[] {
  const steps: ExecutionStep[] = [];

  if (plan.onActivation.cancelSubscriptions) {
    for (const id of account.activeSubscriptionIds) {
      steps.push({ id: `cancel-sub:${id}`, type: "CANCEL_SUBSCRIPTION", subscriptionId: id });
    }
  }
  if (plan.onActivation.cancelOpenInvoices) {
    for (const id of account.openInvoiceIds) {
      steps.push({ id: `cancel-inv:${id}`, type: "CANCEL_INVOICE", invoiceId: id });
    }
  }

  for (const o of plan.obligations) {
    const until = activatedAt + o.continueForDaysAfterActivation * DAY;
    const every = CADENCE_DAYS[o.cadence] * DAY;
    // Monthly cap enforced per 30-day window from activation.
    const paidInWindow = new Map<number, number>();
    for (let n = 0, at = activatedAt; at < until; n++, at += every) {
      const window = Math.floor((at - activatedAt) / (30 * DAY));
      const sofar = paidInWindow.get(window) ?? 0;
      if (sofar + o.amountPerPaymentMinor > o.maxPerMonthMinor) continue;
      paidInWindow.set(window, sofar + o.amountPerPaymentMinor);
      steps.push({
        id: `pay:${o.id}:${n}`,
        type: "PAY_OBLIGATION",
        obligationId: o.id,
        payeeEmail: o.payeeEmail,
        amountMinor: o.amountPerPaymentMinor,
        currency: o.currency,
        dueAt: at,
      });
    }
  }

  steps.push({ id: "executor-package", type: "ASSEMBLE_EXECUTOR_PACKAGE" });
  return steps;
}
