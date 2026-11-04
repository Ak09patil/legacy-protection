import "server-only";

/**
 * The AI agent's two jobs in the app, wired to the policy gate and PayPal's
 * Agent Toolkit. The agent only ever gets read tools here (advisor mode), and
 * every call is authorised by @lp/guard first.
 */

import { AnthropicProvider, canChat, proposeCarersFromHistory, talkItThrough, type ChatMessage, type ChatProvider, type HistoryPayment, type ToolOutcome } from "@lp/ai";
import { appendEvent } from "@lp/db/audit";
import { authorize } from "@lp/guard";
import { db, tx } from "./db";
import type { Ctx } from "./plans";
import { getPayment } from "./payments";

export function chatProvider(): ChatProvider | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || process.env.AI_PROVIDER === "off") return null;
  const p = new AnthropicProvider(key, process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5", undefined, process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com");
  return canChat(p) ? p : null;
}

async function localHistory(planId: string): Promise<HistoryPayment[]> {
  // Notes stay sealed: the agent only needs who was paid, how much and when.
  const r = await db().query<{ payee_name: string; payee_email: string; amount_minor: string; created_at: Date }>(
    `SELECT payee_name, payee_email, amount_minor, created_at FROM payments
      WHERE plan_id = $1 AND status IN ('SENT', 'RELEASED') AND created_at > now() - interval '13 months' ORDER BY created_at`,
    [planId],
  );
  return r.rows.map((x) => ({ payeeName: x.payee_name, payeeEmail: x.payee_email, amountMinor: Number(x.amount_minor), at: x.created_at.getTime() }));
}

/** PayPal's Agent Toolkit, read-only, when sandbox keys are configured. */
async function toolkitTransactions(input: unknown): Promise<string | null> {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) return null;
  const { PayPalAgentToolkit } = await import("@paypal/agent-toolkit/openai");
  const tk = new PayPalAgentToolkit({ clientId: id, clientSecret: secret, configuration: { actions: { transactions: { list: true } }, context: { sandbox: true } } });
  const r = await tk.handleToolCall({ id: "lp", type: "function", function: { name: "list_transactions", arguments: JSON.stringify(input ?? {}) } });
  return typeof r.content === "string" ? r.content : JSON.stringify(r.content);
}

export type SuggestResult =
  | { ok: true; carers: Array<{ payeeName: string; payeeEmail: string; amountPerPaymentMinor: number; cadence: "WEEKLY" | "BIWEEKLY" | "MONTHLY"; why: string; payments: number }>; dropped: string[]; source: string }
  | { ok: false; reason: "AI_OFF" | "PROVIDER_UNAVAILABLE" | "INVALID_OUTPUT" | "TOO_MANY_STEPS" | "NO_HISTORY" };

export async function suggestCarers(ctx: Ctx): Promise<SuggestResult> {
  const provider = chatProvider();
  if (!provider) return { ok: false, reason: "AI_OFF" };
  const history = await localHistory(ctx.planId);
  if (history.length === 0) return { ok: false, reason: "NO_HISTORY" };
  let source = "payments made through Legacy Protection";

  const listTransactions = async (input: unknown): Promise<ToolOutcome> => {
    const v = authorize({ name: "list_transactions", args: input }, { mode: "advisor", phase: "MONITORING", planVersionId: null, steps: [], now: Date.now() });
    if (!v.allow) return { ok: false, content: v.reason };
    const live = await toolkitTransactions(input).catch(() => null);
    if (live && !/"error"/.test(live.slice(0, 40))) source = "PayPal (via the Agent Toolkit) and payments made through Legacy Protection";
    const local = history.map((h) => ({ date: new Date(h.at).toISOString().slice(0, 10), payee: h.payeeName, email: h.payeeEmail, amount: (h.amountMinor / 100).toFixed(2), note: h.note ?? "" }));
    return { ok: true, content: JSON.stringify({ ...(live ? { paypal: live.slice(0, 20_000) } : {}), payments: local }) };
  };

  const r = await proposeCarersFromHistory(provider, listTransactions, history);
  await tx((c) =>
    appendEvent(c, {
      planId: ctx.planId,
      at: new Date(),
      kind: "AI_PROPOSED_CARERS",
      actor: "agent",
      payload: r.ok ? { model: r.model, proposed: r.carers.length, droppedByCode: r.dropped.length, toolCalls: r.toolCalls } : { failed: r.reason },
    }),
  );
  if (!r.ok) return r;
  return {
    ok: true,
    carers: r.carers.map((c) => ({ payeeName: c.payeeName, payeeEmail: c.payeeEmail, amountPerPaymentMinor: c.amountPerPaymentMinor, cadence: c.cadence, why: c.why, payments: c.evidence.payments })),
    dropped: [...r.dropped],
    source,
  };
}

const METHOD_WORDS: Record<string, string> = { p2p: "PayPal", gift_card: "gift cards", crypto: "cryptocurrency", bank_transfer: "a bank transfer" };

export async function talkAboutPayment(ctx: Ctx, paymentId: string, conversation: ChatMessage[], language: "en" | "de" | "es" = "en"): Promise<{ ok: true; reply: string } | { ok: false; reason: string }> {
  const provider = chatProvider();
  if (!provider) return { ok: false, reason: "AI_OFF" };
  const p = await getPayment(ctx, paymentId, "ai_helper");
  if (!p || !["PAUSED", "CONFIRM_NEEDED", "WAITING_FOR_CONTACT", "RELEASE_SCHEDULED"].includes(p.status)) return { ok: false, reason: "NOT_AVAILABLE" };
  const m = await db().query<{ method: string }>(`SELECT method FROM payments WHERE id = $1`, [paymentId]);
  const contact = await db().query<{ display_name: string }>(
    `SELECT u.display_name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.plan_id = $1 AND m.role = 'TRUSTED_CONTACT' AND m.revoked_at IS NULL`,
    [ctx.planId],
  );
  // Only the owner's own turns and the helper's replies; capped in count and length.
  const turns = conversation
    .filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string")
    .slice(-12)
    .map((t) => ({ role: t.role, content: String(t.content).slice(0, 1000) }));
  const r = await talkItThrough(
    provider,
    {
      ownerFirstName: ctx.user.name.split(" ")[0] ?? ctx.user.name,
      payeeName: p.payeeName,
      amount: (p.amountMinor / 100).toLocaleString("en-US", { style: "currency", currency: "USD" }),
      method: METHOD_WORDS[m.rows[0]?.method ?? "p2p"] ?? "PayPal",
      payeeNote: p.note,
      reasons: p.decision?.reasons ?? [],
      contactName: contact.rows[0]?.display_name ?? null,
      language,
    },
    turns,
  );
  // The conversation itself isn't stored; only that it happened (INV-17, INV-21).
  await tx((c) => appendEvent(c, { planId: ctx.planId, at: new Date(), kind: "AI_TALKED_THROUGH_PAYMENT", actor: "agent", payload: { paymentId, ok: r.ok, turn: turns.length } }));
  return r.ok ? { ok: true, reply: r.reply } : { ok: false, reason: r.reason };
}
