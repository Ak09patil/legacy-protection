/**
 * Sending approved payments through PayPal (INV-29).
 *
 * A payment reaches PayPal only from one of two states, each set by an
 * allowed decision:
 *   SENDING            it passed the check, or the owner said "yes, it's right"
 *   RELEASE_SCHEDULED  the owner chose "send anyway", once its 24-hour wait is over
 * Nothing else is ever sent: not a paused payment, not one the owner stopped,
 * not one still waiting for her answer.
 *
 * The app calls this straight after a decision so money moves at once; the
 * worker calls it every few seconds to retry failures and to release payments
 * whose wait has ended. Each row is claimed with SKIP LOCKED, and PayPal's
 * PayPal-Request-Id (derived from our payment id) makes any retry return the
 * first result instead of paying twice.
 */

import { money } from "@lp/core";
import { appendEvent } from "@lp/db/audit";
import { PayPalClient, PayPalError, sendOwnerPayment } from "@lp/paypal";
import type pg from "pg";
import { EMAILS, emailLocale, emailMoney } from "./emails.js";
import { outbox } from "./lifecycle.js";

export interface PaymentSender {
  readonly name: string;
  send(p: { paymentId: string; receiverEmail: string; amountMinor: number; currency: string }): Promise<{ reference: string }>;
}

export const MAX_SEND_ATTEMPTS = 5;

export function senderFromEnv(env: Record<string, string | undefined> = process.env): PaymentSender {
  if (env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET) {
    const client = new PayPalClient({ clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_CLIENT_SECRET });
    return {
      name: "paypal-sandbox",
      async send(p) {
        const r = await sendOwnerPayment(client, { paymentId: p.paymentId, receiverEmail: p.receiverEmail, amount: money(BigInt(p.amountMinor), p.currency) });
        return { reference: r.batch_header.payout_batch_id };
      },
    };
  }
  if (env.NODE_ENV === "production") throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set in production");
  // Local development and tests: nothing leaves the machine, and the reference says so.
  return { name: "dry-run", send: async (p) => ({ reference: `DRYRUN-${p.paymentId.slice(0, 8).toUpperCase()}` }) };
}

/** PayPal said no for a reason a retry won't fix (bad request, refused): give up at once rather than retrying. */
const permanent = (e: unknown) => e instanceof PayPalError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;

export async function sendDuePayments(
  pool: pg.Pool,
  sender: PaymentSender,
  now = new Date(),
  opts: { onlyPaymentId?: string; batch?: number } = {},
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < (opts.batch ?? 20); i++) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const r = await c.query<{ id: string; plan_id: string; payee_email: string; payee_name: string; amount_minor: string; currency: string; status: string; send_attempts: number }>(
        `SELECT id, plan_id, payee_email, payee_name, amount_minor, currency, status, send_attempts FROM payments
          WHERE (status = 'SENDING' OR (status = 'RELEASE_SCHEDULED' AND release_at <= $1))
            AND send_attempts < $2 AND coalesce(next_send_at, $1) <= $1
            AND ($3::uuid IS NULL OR id = $3)
          ORDER BY coalesce(next_send_at, release_at, created_at) LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [now, MAX_SEND_ATTEMPTS, opts.onlyPaymentId ?? null],
      );
      const p = r.rows[0];
      if (!p) {
        await c.query("COMMIT");
        break;
      }
      const released = p.status === "RELEASE_SCHEDULED";
      try {
        const { reference } = await sender.send({ paymentId: p.id, receiverEmail: p.payee_email, amountMinor: Number(p.amount_minor), currency: p.currency });
        await c.query(
          `UPDATE payments SET status = $2, paypal_ref = $3, sent_at = $4, send_error = NULL, updated_at = now() WHERE id = $1`,
          [p.id, released ? "RELEASED" : "SENT", reference, now],
        );
        await appendEvent(c, { planId: p.plan_id, at: now, kind: released ? "PAYMENT_RELEASED" : "PAYMENT_SENT", actor: "system", payload: { paymentId: p.id, paypalRef: reference, via: sender.name } });
        sent++;
      } catch (e) {
        const message = String(e instanceof Error ? e.message : e).slice(0, 300);
        const attempts = p.send_attempts + 1;
        const giveUp = permanent(e) || attempts >= MAX_SEND_ATTEMPTS;
        if (giveUp) {
          await c.query(`UPDATE payments SET status = 'FAILED', send_attempts = $2, send_error = $3, updated_at = now() WHERE id = $1`, [p.id, attempts, message]);
          await appendEvent(c, { planId: p.plan_id, at: now, kind: "PAYMENT_FAILED", actor: "system", payload: { paymentId: p.id } });
          // Tell her plainly: the money didn't go, so she isn't left wondering.
          const o = await c.query<{ id: string; email: string; locale: string; display_name: string }>(
            `SELECT u.id, u.email, u.locale, u.display_name FROM plans pl JOIN users u ON u.id = pl.owner_id WHERE pl.id = $1`,
            [p.plan_id],
          );
          const owner = o.rows[0];
          if (owner) {
            const lang = emailLocale(owner.locale);
            const [subject, body] = EMAILS[lang].paymentFailed(p.payee_name, emailMoney(lang, p.amount_minor));
            await outbox(c, p.plan_id, owner.id, owner.email, "OWNER_PAYMENT_FAILED", subject, body, now);
          }
        } else {
          await c.query(`UPDATE payments SET send_attempts = $2, send_error = $3, next_send_at = $4, updated_at = now() WHERE id = $1`, [
            p.id,
            attempts,
            message,
            new Date(now.getTime() + 30_000 * 2 ** attempts),
          ]);
        }
        failed++;
      }
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }
  return { sent, failed };
}
