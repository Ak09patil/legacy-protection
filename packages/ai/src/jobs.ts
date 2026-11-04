/**
 * The two jobs the AI does for Eleanor. In both, the model proposes and code
 * decides: its output is schema-validated and checked against real data
 * before anyone sees it, and neither job can move money (INV-01).
 */

import { z } from "zod";
import type { Reason } from "@lp/policy";
import { runAgent, type ChatMessage, type ChatProvider, type ToolDef, type ToolOutcome } from "./agent.js";
import { extractJsonObject, wrapUntrusted } from "./untrusted.js";

// ---------------------------------------------------------------------------
// 1. Reading 12 months of PayPal history and proposing who should keep being paid
// ---------------------------------------------------------------------------

export interface HistoryPayment {
  readonly payeeName: string;
  readonly payeeEmail: string;
  readonly amountMinor: number;
  readonly at: number;
  readonly note?: string;
}

export interface CarerProposal {
  readonly payeeName: string;
  readonly payeeEmail: string;
  readonly amountPerPaymentMinor: number;
  readonly cadence: "WEEKLY" | "BIWEEKLY" | "MONTHLY";
  readonly why: string;
  /** Filled in by code from the real history, never by the model. */
  readonly evidence: { readonly payments: number; readonly firstAt: number; readonly lastAt: number };
}

const ProposalSchema = z
  .object({
    carers: z
      .array(
        z
          .object({
            payeeName: z.string().min(1).max(100),
            payeeEmail: z.string().email().max(254),
            amountPerPaymentMinor: z.number().int().positive().max(10_000_000),
            cadence: z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY"]),
            why: z.string().max(240),
          })
          .strict(),
      )
      .max(5),
  })
  .strict();

const HISTORY_SYSTEM = `You help an older person set up Legacy Protection on their PayPal account.
Use the list_transactions tool to read their recent payments. Then identify people who work in their home
and are paid regularly: carers, home health aides, cleaners, gardeners. These are the only people whose pay
can continue if the person can no longer act, so care at home doesn't stop suddenly.

Never include: family or friends, subscriptions and companies, charities, one-off payments, or anyone paid
fewer than 3 times. If unsure, leave them out; the person can add someone themselves.

Reply with ONLY this JSON, no other text:
{"carers":[{"payeeName":string,"payeeEmail":string,"amountPerPaymentMinor":integer cents,"cadence":"WEEKLY"|"BIWEEKLY"|"MONTHLY","why":"one short plain sentence"}]}`;

export type ProposalResult =
  | { readonly ok: true; readonly carers: readonly CarerProposal[]; readonly dropped: readonly string[]; readonly model: string; readonly toolCalls: number }
  | { readonly ok: false; readonly reason: "PROVIDER_UNAVAILABLE" | "INVALID_OUTPUT" | "TOO_MANY_STEPS" };

/**
 * `listTransactions` is the gated read tool (PayPal's Agent Toolkit behind
 * @lp/guard). `history` is the same data parsed by code, used to verify
 * every proposal: a payee the model names must really have been paid at
 * least 3 times, at roughly the amount it claims.
 */
export async function proposeCarersFromHistory(
  provider: ChatProvider,
  listTransactions: (input: unknown) => Promise<ToolOutcome>,
  history: readonly HistoryPayment[],
): Promise<ProposalResult> {
  const tools: ToolDef[] = [
    {
      name: "list_transactions",
      description: "Lists the person's PayPal transactions for a date range (at most 31 days per call).",
      input_schema: {
        type: "object",
        properties: { start_date: { type: "string" }, end_date: { type: "string" } },
        additionalProperties: false,
      },
    },
  ];
  let calls = 0;
  const r = await runAgent({
    provider,
    system: HISTORY_SYSTEM,
    messages: [{ role: "user", content: "Please look at my recent PayPal payments and suggest who should keep being paid." }],
    tools,
    callTool: async (_name, input) => {
      calls++;
      return listTransactions(input);
    },
    maxSteps: 8,
  });
  if (!r.ok) return { ok: false, reason: r.reason };

  let parsed: z.infer<typeof ProposalSchema>;
  try {
    const p = ProposalSchema.safeParse(extractJsonObject(r.text));
    if (!p.success) return { ok: false, reason: "INVALID_OUTPUT" };
    parsed = p.data;
  } catch {
    return { ok: false, reason: "INVALID_OUTPUT" };
  }

  // Code checks every claim against the real history.
  const carers: CarerProposal[] = [];
  const dropped: string[] = [];
  for (const c of parsed.carers) {
    const paid = history.filter((h) => h.payeeEmail.toLowerCase() === c.payeeEmail.toLowerCase());
    const typical = paid.length ? [...paid.map((h) => h.amountMinor)].sort((a, b) => a - b)[Math.floor(paid.length / 2)]! : 0;
    const amountOk = typical > 0 && c.amountPerPaymentMinor <= typical * 1.25;
    if (paid.length < 3 || !amountOk) {
      dropped.push(c.payeeName);
      continue;
    }
    carers.push({
      ...c,
      payeeEmail: c.payeeEmail.toLowerCase(),
      evidence: { payments: paid.length, firstAt: Math.min(...paid.map((h) => h.at)), lastAt: Math.max(...paid.map((h) => h.at)) },
    });
  }
  return { ok: true, carers, dropped, model: r.model, toolCalls: calls };
}

// ---------------------------------------------------------------------------
// 2. Talking a paused payment through, the way a calm grandchild would
// ---------------------------------------------------------------------------

export interface PausedPaymentContext {
  readonly ownerFirstName: string;
  readonly payeeName: string;
  readonly amount: string;
  readonly method: string;
  readonly payeeNote: string;
  readonly reasons: readonly Pick<Reason, "code" | "text">[];
  readonly contactName: string | null;
}

const TALK_SYSTEM = (c: PausedPaymentContext) => `You are a calm, kind helper inside Legacy Protection, talking with ${c.ownerFirstName},
an older person whose payment was just paused because it looks like a scam. You are not a person and you
don't pretend to be one.

What you know (from the payment check, not from the payee):
- Payment: ${c.amount} to ${c.payeeName}, asked for as: ${c.method}
- Why it was paused: ${c.reasons.map((r) => r.text).join(" ")}
- Trusted contact: ${c.contactName ?? "none set up yet"}

How to help:
- Explain plainly why this looks risky. Use their words back to them. Short sentences. At most 90 words.
- Ask what the person who asked for the money told them, if you don't know yet.
- Real companies, banks and government offices never ask for gift cards, crypto or secrecy, and never rush you.
- Suggest calling the company or person back on a number they already have, not one from the message.
- ${c.contactName ? `Offer to let them talk it over with ${c.contactName}.` : "Suggest talking to someone they trust."}

You cannot send, release or approve the payment, and you must never tell them to send it, buy gift cards,
share codes, or give anyone remote access. Only they can decide, using the buttons on the screen.
If they say they're in danger or being threatened, tell them to call 911.`;

export type TalkResult = { readonly ok: true; readonly reply: string; readonly model: string } | { readonly ok: false; readonly reason: "PROVIDER_UNAVAILABLE" | "TOO_MANY_STEPS" };

const FORBIDDEN_ADVICE = /\b(send (it|the money|the payment)|go ahead and (pay|send)|buy (the )?gift ?cards?|share (the )?code|remote access|it'?s (safe|fine) to (pay|send))\b/i;

export async function talkItThrough(provider: ChatProvider, ctx: PausedPaymentContext, conversation: readonly ChatMessage[]): Promise<TalkResult> {
  const note = ctx.payeeNote ? `The payee's message, quoted:\n${wrapUntrusted("payee_note", ctx.payeeNote).block}` : "There was no message from the payee.";
  const first: ChatMessage = { role: "user", content: `${note}\n\n(Start by gently explaining why we paused it.)` };
  const r = await runAgent({ provider, system: TALK_SYSTEM(ctx), messages: [first, ...conversation.slice(-12)], tools: [], callTool: async () => ({ ok: false, content: "No tools." }), maxSteps: 1, maxTokens: 300 });
  if (!r.ok) return { ok: false, reason: r.reason };
  // A last check in code: never let the helper talk someone into sending.
  const reply = FORBIDDEN_ADVICE.test(r.text)
    ? `I can't help send this payment. ${ctx.contactName ? `Would you like to talk it over with ${ctx.contactName} first?` : "Please talk to someone you trust before deciding."}`
    : r.text.slice(0, 900);
  return { ok: true, reply, model: r.model };
}
