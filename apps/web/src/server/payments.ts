import "server-only";

/**
 * Paused payments and the owner's choices about them.
 *
 * Only the owner can release a paused payment (INV-08), and a release of a
 * held payment waits 24 hours and tells the trusted contact: scammers rely on
 * urgency. Every choice is written to the audit log in the same transaction
 * as the status change.
 */

import { appendEvent } from "@lp/db/audit";
import type { Reason } from "@lp/policy";
import { db, tx } from "./db";
import { applyEvent, outbox, type Ctx } from "./plans";

export const RELEASE_COOLING_OFF_MS = 24 * 3_600_000;

export type PaymentStatus = "PAUSED" | "STOPPED_BY_OWNER" | "WAITING_FOR_CONTACT" | "RELEASE_SCHEDULED" | "SENT" | "RELEASED" | "FAILED";
export type PaymentAction = "stop" | "ask-contact" | "send-anyway" | "cancel-release";

export interface PaymentView {
  id: string;
  payeeName: string;
  amountMinor: number;
  currency: string;
  note: string;
  status: PaymentStatus;
  releaseAt: number | null;
  createdAt: number;
  decision: { level: "PASS" | "REVIEW" | "HOLD"; reasons: Reason[]; policyVersion: string } | null;
  history: Array<{ at: number; kind: string }>;
}

export async function getPayment(ctx: Ctx, id: string): Promise<PaymentView | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const p = await db().query<{
    id: string; payee_name: string; amount_minor: string; currency: string; note: string; status: PaymentStatus; release_at: Date | null; created_at: Date;
  }>(`SELECT id, payee_name, amount_minor, currency, note, status, release_at, created_at FROM payments WHERE id = $1 AND plan_id = $2`, [id, ctx.planId]);
  const row = p.rows[0];
  if (!row) return null;
  const [d, h] = await Promise.all([
    db().query<{ level: "PASS" | "REVIEW" | "HOLD"; reasons: Reason[]; policy_version: string }>(
      `SELECT level, reasons, policy_version FROM payment_decisions WHERE payment_id = $1 ORDER BY id DESC LIMIT 1`,
      [id],
    ),
    db().query<{ at: Date; kind: string }>(
      `SELECT at, kind FROM audit_events WHERE plan_id = $1 AND payload->>'paymentId' = $2 ORDER BY seq`,
      [ctx.planId, id],
    ),
  ]);
  const dec = d.rows[0];
  return {
    id: row.id,
    payeeName: row.payee_name,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    note: row.note,
    status: row.status,
    releaseAt: row.release_at?.getTime() ?? null,
    createdAt: row.created_at.getTime(),
    decision: dec ? { level: dec.level, reasons: dec.reasons, policyVersion: dec.policy_version } : null,
    history: h.rows.map((x) => ({ at: x.at.getTime(), kind: x.kind })),
  };
}

const ALLOWED_FROM: Record<PaymentAction, PaymentStatus[]> = {
  stop: ["PAUSED", "WAITING_FOR_CONTACT", "RELEASE_SCHEDULED"],
  "ask-contact": ["PAUSED"],
  "send-anyway": ["PAUSED", "WAITING_FOR_CONTACT"],
  "cancel-release": ["RELEASE_SCHEDULED"],
};

export async function actOnPayment(ctx: Ctx, id: string, action: PaymentAction): Promise<{ ok: boolean; message?: string }> {
  if (ctx.role !== "OWNER") return { ok: false, message: "Only the account owner can decide about a payment." };
  return tx(async (c) => {
    const r = await c.query<{ status: PaymentStatus; payee_name: string; amount_minor: string }>(
      `SELECT status, payee_name, amount_minor FROM payments WHERE id = $1 AND plan_id = $2 FOR UPDATE`,
      [id, ctx.planId],
    );
    const p = r.rows[0];
    if (!p) return { ok: false, message: "Payment not found." };
    if (!ALLOWED_FROM[action].includes(p.status)) return { ok: false, message: "That choice isn’t available any more." };

    const now = new Date();
    const next: Record<PaymentAction, PaymentStatus> = {
      stop: "STOPPED_BY_OWNER",
      "ask-contact": "WAITING_FOR_CONTACT",
      "send-anyway": "RELEASE_SCHEDULED",
      "cancel-release": "STOPPED_BY_OWNER",
    };
    const releaseAt = action === "send-anyway" ? new Date(now.getTime() + RELEASE_COOLING_OFF_MS) : null;
    await c.query(`UPDATE payments SET status = $2, release_at = $3, updated_at = now() WHERE id = $1`, [id, next[action], releaseAt]);
    await appendEvent(c, {
      planId: ctx.planId,
      at: now,
      kind: `PAYMENT_${action.toUpperCase().replace("-", "_")}`,
      actor: ctx.user.id,
      payload: { paymentId: id, ...(releaseAt ? { releaseAt: releaseAt.toISOString() } : {}) },
    });

    if (action === "ask-contact" || action === "send-anyway") {
      const k = await c.query<{ id: string; email: string }>(
        `SELECT u.id, u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.plan_id = $1 AND m.role = 'TRUSTED_CONTACT' AND m.revoked_at IS NULL`,
        [ctx.planId],
      );
      const contact = k.rows[0];
      if (contact) {
        const first = ctx.user.name.split(" ")[0];
        const amount = (Number(p.amount_minor) / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
        const [subject, body] =
          action === "ask-contact"
            ? [`${first} would like to talk about a payment`, `We paused a payment of ${amount} from ${first} to someone new, and ${first} asked to talk it over with you. Please give them a call.`]
            : [`${first} chose to send a paused payment`, `${first} chose to send ${amount} to someone new that we had paused. It goes in 24 hours unless they change their mind. If this looks like a scam, please call them now.`];
        await outbox(c, ctx.planId, contact.id, contact.email, `PAYMENT_${action.toUpperCase().replace("-", "_")}`, subject, body, now);
      }
    }
    // Any choice the owner makes is also a sign they're well (INV-07).
    await applyEvent(c, ctx.planId, { type: "OWNER_ACTIVITY", at: now.getTime() }, ctx.user.id, { channel: "payment_decision" });
    return { ok: true };
  });
}
