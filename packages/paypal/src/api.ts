/**
 * The PayPal operations Legacy Protection uses, as typed functions.
 * Request shapes follow PayPal's REST API reference (Payouts v1, Invoicing v2,
 * Subscriptions v1, Transaction Search v1, Notifications v1).
 */

import { moneyActionKey, toDecimal, type Money } from "@lp/core";
import type { PayPalClient } from "./client.js";

// ---------- Payouts: paying a registered caregiver ----------

export interface CaregiverPayout {
  readonly planVersionId: string;
  readonly stepId: string;
  readonly receiverEmail: string;
  readonly amount: Money;
  readonly note: string;
}

export interface PayoutBatchResult {
  batch_header: { payout_batch_id: string; batch_status: string; sender_batch_header: { sender_batch_id: string } };
}

export async function payCaregiver(client: PayPalClient, p: CaregiverPayout): Promise<PayoutBatchResult> {
  const key = moneyActionKey(p.planVersionId, p.stepId); // INV-03
  return client.request<PayoutBatchResult>({
    method: "POST",
    path: "/v1/payments/payouts",
    idempotencyKey: key,
    body: {
      sender_batch_header: {
        // PayPal also rejects a reused sender_batch_id: a second layer of protection.
        sender_batch_id: key.slice(0, 30),
        email_subject: "Payment from a Legacy Protection plan",
        email_message: p.note,
      },
      items: [
        {
          recipient_type: "EMAIL",
          receiver: p.receiverEmail,
          amount: { value: toDecimal(p.amount), currency: p.amount.currency },
          note: p.note,
          sender_item_id: p.stepId.slice(0, 63),
        },
      ],
    },
  });
}

// ---------- Invoicing: cancelling open invoices ----------

export async function cancelInvoice(
  client: PayPalClient,
  a: { planVersionId: string; stepId: string; invoiceId: string; note: string },
): Promise<void> {
  await client.request<void>({
    method: "POST",
    path: `/v2/invoicing/invoices/${encodeURIComponent(a.invoiceId)}/cancel`,
    idempotencyKey: moneyActionKey(a.planVersionId, a.stepId),
    body: { subject: "Invoice cancelled", note: a.note, send_to_invoicer: true, send_to_recipient: true },
  });
}

// ---------- Subscriptions: stopping recurring charges ----------

export async function cancelSubscription(
  client: PayPalClient,
  a: { planVersionId: string; stepId: string; subscriptionId: string; reason: string },
): Promise<void> {
  await client.request<void>({
    method: "POST",
    path: `/v1/billing/subscriptions/${encodeURIComponent(a.subscriptionId)}/cancel`,
    idempotencyKey: moneyActionKey(a.planVersionId, a.stepId),
    body: { reason: a.reason.slice(0, 128) },
  });
}

// ---------- Transaction Search: account history ----------

export interface TransactionDetail {
  transaction_info: {
    transaction_id: string;
    transaction_event_code?: string;
    transaction_initiation_date: string;
    transaction_amount: { currency_code: string; value: string };
    transaction_status?: string;
    transaction_note?: string;
    transaction_subject?: string;
  };
  payer_info?: { email_address?: string; account_id?: string };
}

interface SearchPage {
  transaction_details: TransactionDetail[];
  total_pages: number;
  page: number;
}

const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;

/** Splits [start, end) into windows of at most 31 days, as the API requires. */
export function searchWindows(start: Date, end: Date): Array<[Date, Date]> {
  if (end <= start) return [];
  const out: Array<[Date, Date]> = [];
  for (let s = start.getTime(); s < end.getTime(); s += MAX_WINDOW_MS) {
    out.push([new Date(s), new Date(Math.min(s + MAX_WINDOW_MS, end.getTime()))]);
  }
  return out;
}

export async function listTransactions(client: PayPalClient, start: Date, end: Date): Promise<TransactionDetail[]> {
  const all: TransactionDetail[] = [];
  for (const [s, e] of searchWindows(start, end)) {
    let page = 1;
    let total = 1;
    do {
      const res = await client.request<SearchPage>({
        method: "GET",
        path: "/v1/reporting/transactions",
        query: {
          start_date: s.toISOString().replace(/\.\d{3}Z$/, "Z"),
          end_date: e.toISOString().replace(/\.\d{3}Z$/, "Z"),
          fields: "all",
          page_size: 500,
          page,
        },
      });
      all.push(...(res.transaction_details ?? []));
      total = res.total_pages ?? 1;
      page++;
    } while (page <= total);
  }
  return all;
}

// ---------- Webhooks: signature verification ----------

export interface WebhookHeaders {
  readonly "paypal-auth-algo"?: string;
  readonly "paypal-cert-url"?: string;
  readonly "paypal-transmission-id"?: string;
  readonly "paypal-transmission-sig"?: string;
  readonly "paypal-transmission-time"?: string;
}

/**
 * Verifies a webhook with PayPal's verify-webhook-signature endpoint.
 * Returns false on any missing header. Never throws on a bad signature;
 * callers must drop unverified events (THREAT_MODEL T7).
 */
export async function verifyWebhook(
  client: PayPalClient,
  webhookId: string,
  headers: WebhookHeaders,
  rawBody: string,
): Promise<boolean> {
  const required = [
    "paypal-auth-algo",
    "paypal-cert-url",
    "paypal-transmission-id",
    "paypal-transmission-sig",
    "paypal-transmission-time",
  ] as const;
  if (required.some((h) => !headers[h])) return false;

  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return false;
  }

  const res = await client.request<{ verification_status: string }>({
    method: "POST",
    path: "/v1/notifications/verify-webhook-signature",
    // Verification has no side effects; key it by transmission so retries are harmless.
    idempotencyKey: `lp-verify-${headers["paypal-transmission-id"]}`,
    body: {
      auth_algo: headers["paypal-auth-algo"],
      cert_url: headers["paypal-cert-url"],
      transmission_id: headers["paypal-transmission-id"],
      transmission_sig: headers["paypal-transmission-sig"],
      transmission_time: headers["paypal-transmission-time"],
      webhook_id: webhookId,
      webhook_event: event,
    },
  });
  return res.verification_status === "SUCCESS";
}
