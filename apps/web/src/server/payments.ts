import "server-only";

/**
 * Paused payments and the owner's choices about them.
 *
 * Only the owner can release a paused payment (INV-08), and a release of a
 * held payment waits 24 hours and tells the trusted contact: scammers rely on
 * urgency. Every choice is written to the audit log in the same transaction
 * as the status change.
 */

import { randomUUID } from "node:crypto";
import { appendEvent } from "@lp/db/audit";
import { decide, evaluateRules, keywordLabels, MODEL_TEXT_LABELS, relationshipFacts, RULES_VERSION, type ModelOutcome, type Reason, type TextLabel } from "@lp/policy";
import { z } from "zod";
import { db, tx } from "./db";
import { applyEvent, outbox, snapshot, type Ctx } from "./plans";
import { EMAILS, emailLocale, emailMoney } from "@lp/service";
import { assessPayment } from "./risk";
import { webVault } from "./vault";

export const POLICY_VERSION = `policy-1.0.0+${RULES_VERSION}`;

export const RELEASE_COOLING_OFF_MS = 24 * 3_600_000;

export type PaymentStatus = "CONFIRM_NEEDED" | "PAUSED" | "STOPPED_BY_OWNER" | "WAITING_FOR_CONTACT" | "RELEASE_SCHEDULED" | "SENT" | "RELEASED" | "FAILED";
export type PaymentAction = "confirm" | "stop" | "ask-contact" | "send-anyway" | "cancel-release";

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

export async function getPayment(ctx: Ctx, id: string, purpose: "owner_view" | "ai_helper" = "owner_view"): Promise<PaymentView | null> {
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
    note: row.note ? await webVault().openField(ctx.planId, "payment_note", row.note, purpose) : "",
    status: row.status,
    releaseAt: row.release_at?.getTime() ?? null,
    createdAt: row.created_at.getTime(),
    decision: dec ? { level: dec.level, reasons: dec.reasons, policyVersion: dec.policy_version } : null,
    history: h.rows.map((x) => ({ at: x.at.getTime(), kind: x.kind })),
  };
}

const ALLOWED_FROM: Record<PaymentAction, PaymentStatus[]> = {
  confirm: ["CONFIRM_NEEDED"],
  stop: ["CONFIRM_NEEDED", "PAUSED", "WAITING_FOR_CONTACT", "RELEASE_SCHEDULED"],
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
      confirm: "SENT",
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
      const k = await c.query<{ id: string; email: string; locale: string }>(
        `SELECT u.id, u.email, u.locale FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.plan_id = $1 AND m.role = 'TRUSTED_CONTACT' AND m.revoked_at IS NULL`,
        [ctx.planId],
      );
      const contact = k.rows[0];
      if (contact) {
        const first = ctx.user.name.split(" ")[0] ?? ctx.user.name;
        const lang = emailLocale(contact.locale);
        const amount = emailMoney(lang, p.amount_minor);
        const [subject, body] = action === "ask-contact" ? EMAILS[lang].paymentAskContact(first, amount) : EMAILS[lang].paymentSendAnyway(first, amount);
        await outbox(c, ctx.planId, contact.id, contact.email, `PAYMENT_${action.toUpperCase().replace("-", "_")}`, subject, body, now);
      }
    }
    // Any choice the owner makes is also a sign they're well (INV-07).
    await applyEvent(c, ctx.planId, { type: "OWNER_ACTIVITY", at: now.getTime() }, ctx.user.id, { channel: "payment_decision" });
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Making a payment: every payment is checked before any money moves
// ---------------------------------------------------------------------------

export const NewPayment = z.object({
  payeeName: z.string().trim().min(1, "Who are you paying?").max(100),
  payeeEmail: z.string().trim().toLowerCase().email("Please enter their PayPal email.").max(254),
  amount: z
    .string()
    .trim()
    .regex(/^\d{1,7}(\.\d{1,2})?$/, "Please enter an amount like 42 or 42.50.")
    .transform((v) => Math.round(Number(v) * 100))
    .refine((m) => m > 0 && m <= 10_000_000, "Amounts from $0.01 to $100,000."),
  method: z.enum(["p2p", "gift_card", "crypto", "bank_transfer"]),
  note: z.string().trim().max(500).default(""),
});

export type CreateResult = { ok: true; id: string; level: "PASS" | "REVIEW" | "HOLD" } | { ok: false; message: string };

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Checks a new payment and records the decision. Facts come from the owner's
 * own history and confirmed plan; scam language is labelled by keywords
 * (always) and the AI model (when configured, and fail-closed); the risk
 * service adds the model and network signals. The final level is the most
 * cautious of all of them (INV-10, INV-11).
 */
export async function createPayment(ctx: Ctx, input: unknown): Promise<CreateResult> {
  if (ctx.role !== "OWNER") return { ok: false, message: "Only the account owner can make payments." };
  const parsed = NewPayment.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Please check the payment." };
  const p = { ...parsed.data, amountMinor: parsed.data.amount };
  const snap = await snapshot(ctx.planId);
  const plan = snap.confirmed?.document ?? null;
  const tz = plan?.checkin.timeZone ?? "UTC";
  const now = new Date();

  // Facts from the owner's own history.
  const hist = await db().query<{ payee_email: string; amount_minor: string; created_at: Date }>(
    `SELECT payee_email, amount_minor, created_at FROM payments WHERE plan_id = $1 AND status IN ('SENT', 'RELEASED') ORDER BY created_at`,
    [ctx.planId],
  );
  const history = hist.rows.map((h) => ({ payeeId: h.payee_email, amountMinor: Number(h.amount_minor), at: h.created_at }));
  // Payments not sent yet but not stopped either: they count towards totals, so queueing several at once can't slip under (INV-27).
  const pend = await db().query<{ payee_email: string; amount_minor: string; created_at: Date }>(
    `SELECT payee_email, amount_minor, created_at FROM payments WHERE plan_id = $1 AND status IN ('CONFIRM_NEEDED', 'PAUSED', 'WAITING_FOR_CONTACT', 'RELEASE_SCHEDULED')`,
    [ctx.planId],
  );
  const waiting = pend.rows.map((h) => ({ payeeId: h.payee_email, amountMinor: Number(h.amount_minor), at: h.created_at }));
  const typical = median(history.map((h) => h.amountMinor));
  const carer = plan?.obligations.find((o) => o.payeeEmail === p.payeeEmail);
  const monthStart = new Date(now.getTime() - 30 * 86_400_000);
  const paidToCarer = carer
    ? history.filter((h) => h.payeeId === p.payeeEmail && h.at >= monthStart).reduce((a, h) => a + h.amountMinor, 0)
    : 0;

  // Scam language: keywords always; the AI labeller adds to them when configured.
  let labels: TextLabel[] = keywordLabels(p.note);
  // Being asked for gift cards or crypto is the signal itself, with or without a message to read.
  if (p.method === "gift_card" && !labels.includes("GIFT_CARD_REQUEST")) labels.push("GIFT_CARD_REQUEST");
  if (p.method === "crypto" && !labels.includes("CRYPTO_REQUEST")) labels.push("CRYPTO_REQUEST");
  // If the AI reader of the payee's message is down, keywords still apply and
  // the owner is asked to confirm (REVIEW): money never moves on a payment we
  // couldn't fully read, but an AI outage doesn't freeze everyone's payments.
  let textCheckUnavailable = false;
  let labeller = "keywords-1";
  if (p.note && process.env.AI_PROVIDER !== "off" && (process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY)) {
    const { labelPaymentText, providerFromEnv } = await import("@lp/ai");
    const r = await labelPaymentText(
      providerFromEnv({
        AI_PROVIDER: process.env.AI_PROVIDER,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
        ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
        GEMINI_API_KEY: process.env.GEMINI_API_KEY,
        GEMINI_MODEL: process.env.GEMINI_MODEL,
      }),
      p.note,
    );
    if (r.ok) {
      labels = [...new Set([...labels, ...r.labels])];
      labeller = `keywords-1+${r.model}`;
    } else {
      textCheckUnavailable = true;
    }
  }

  const facts = {
    payeeIsNew: !history.some((h) => h.payeeId === p.payeeEmail),
    payeeIsRegisteredCaregiver: !!carer,
    amountRatioToTypical: typical ? p.amountMinor / typical : null,
    textLabels: labels,
    withinRegisteredObligationCap: carer ? paidToCarer + p.amountMinor <= carer.maxPerMonthMinor && p.amountMinor <= carer.amountPerPaymentMinor : true,
    amountMinor: p.amountMinor,
    relationship: relationshipFacts(history, waiting, p.payeeEmail, p.amountMinor, now),
  };
  const hourLocal = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(now)) % 24;
  const assessed = await assessPayment({ payeeId: p.payeeEmail, amountMinor: p.amountMinor, at: now, hourLocal, method: p.method, textLabels: labels.filter((l) => MODEL_TEXT_LABELS.includes(l)), history });
  const model: ModelOutcome =
    textCheckUnavailable && assessed.status === "OK"
      ? {
          status: "OK",
          signals: [
            ...assessed.signals,
            {
              level: "REVIEW",
              networkOnly: false,
              modelVersion: "text-reader",
              reasons: [{ code: "TEXT_CHECK_UNAVAILABLE", text: "We couldn’t finish reading their message, so please check this payment is right.", source: "SYSTEM" }],
            },
          ],
        }
      : assessed;
  const decision = decide(evaluateRules(facts), model, {
    payeeIsRegisteredCaregiver: facts.payeeIsRegisteredCaregiver,
    policyVersion: POLICY_VERSION,
    planVersionId: snap.confirmed?.id ?? null,
    ownerHistoryCount: history.length,
  });

  const id = randomUUID();
  // What the payee wrote is sealed before it's stored (INV-24).
  const sealedNote = p.note ? await webVault().sealField(ctx.planId, "payment_note", p.note, "owner_view") : "";
  const status: PaymentStatus = decision.level === "PASS" ? "SENT" : decision.level === "REVIEW" ? "CONFIRM_NEEDED" : "PAUSED";
  await tx(async (c) => {
    await c.query(
      `INSERT INTO payments (id, plan_id, payee_name, payee_email, amount_minor, currency, method, note, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'USD', $6, $7, $8, $9)`,
      [id, ctx.planId, p.payeeName, p.payeeEmail, p.amountMinor, p.method, sealedNote, status, now],
    );
    await c.query(
      `INSERT INTO payment_decisions (payment_id, level, reasons, policy_version, model_version, model_status, decided_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, decision.level, JSON.stringify(decision.reasons), decision.policyVersion, decision.modelVersions.join(",") || null, model.status, now],
    );
    await appendEvent(c, {
      planId: ctx.planId,
      at: now,
      kind: "PAYMENT_DECIDED",
      actor: "policy",
      payload: {
        paymentId: id,
        level: decision.level,
        reasonCodes: decision.reasons.map((r) => r.code),
        policyVersion: decision.policyVersion,
        modelVersions: decision.modelVersions,
        modelStatus: model.status,
        labeller,
      },
    });
    // Making a payment is a sign the owner is well (INV-07).
    await applyEvent(c, ctx.planId, { type: "OWNER_ACTIVITY", at: now.getTime() }, ctx.user.id, { channel: "payment" });
  });
  return { ok: true, id, level: decision.level };
}
