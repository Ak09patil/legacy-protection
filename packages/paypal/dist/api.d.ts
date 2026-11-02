/**
 * The PayPal operations Legacy Protection uses, as typed functions.
 * Request shapes follow PayPal's REST API reference (Payouts v1, Invoicing v2,
 * Subscriptions v1, Transaction Search v1, Notifications v1).
 */
import { type Money } from "@lp/core";
import type { PayPalClient } from "./client.js";
export interface CaregiverPayout {
    readonly planVersionId: string;
    readonly stepId: string;
    readonly receiverEmail: string;
    readonly amount: Money;
    readonly note: string;
}
export interface PayoutBatchResult {
    batch_header: {
        payout_batch_id: string;
        batch_status: string;
        sender_batch_header: {
            sender_batch_id: string;
        };
    };
}
export declare function payCaregiver(client: PayPalClient, p: CaregiverPayout): Promise<PayoutBatchResult>;
export declare function cancelInvoice(client: PayPalClient, a: {
    planVersionId: string;
    stepId: string;
    invoiceId: string;
    note: string;
}): Promise<void>;
export declare function cancelSubscription(client: PayPalClient, a: {
    planVersionId: string;
    stepId: string;
    subscriptionId: string;
    reason: string;
}): Promise<void>;
export interface TransactionDetail {
    transaction_info: {
        transaction_id: string;
        transaction_event_code?: string;
        transaction_initiation_date: string;
        transaction_amount: {
            currency_code: string;
            value: string;
        };
        transaction_status?: string;
        transaction_note?: string;
        transaction_subject?: string;
    };
    payer_info?: {
        email_address?: string;
        account_id?: string;
    };
}
/** Splits [start, end) into windows of at most 31 days, as the API requires. */
export declare function searchWindows(start: Date, end: Date): Array<[Date, Date]>;
export declare function listTransactions(client: PayPalClient, start: Date, end: Date): Promise<TransactionDetail[]>;
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
export declare function verifyWebhook(client: PayPalClient, webhookId: string, headers: WebhookHeaders, rawBody: string): Promise<boolean>;
