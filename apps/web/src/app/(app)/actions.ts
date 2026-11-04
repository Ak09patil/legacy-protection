"use server";

import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { beginStepUp, finishStepUp } from "@/server/auth";
import { tx } from "@/server/db";
import { actOnPayment, type PaymentAction } from "@/server/payments";
import { applyEvent, checkIn, confirmPlan, inviteExecutor, reissueInvite, requireRole, saveDraft } from "@/server/plans";
import { PlanDocumentSchema, summarisePlan } from "@lp/policy";

export async function checkInAction(): Promise<void> {
  const ctx = await requireRole("OWNER");
  await checkIn(ctx, "app");
  revalidatePath("/home");
}

export async function previewPlanAction(plan: unknown): Promise<{ ok: true; summary: string[] } | { ok: false; issues: string[] }> {
  const ctx = await requireRole("OWNER");
  await saveDraft(ctx, plan);
  const p = PlanDocumentSchema.safeParse(plan);
  if (!p.success) return { ok: false, issues: p.error.issues.map((i) => i.message) };
  return { ok: true, summary: summarisePlan(p.data) };
}

export async function confirmPlanAction(plan: unknown) {
  const ctx = await requireRole("OWNER");
  const r = await confirmPlan(ctx, plan);
  if (!r.ok) return r;
  revalidatePath("/plan");
  revalidatePath("/home");
  redirect(`/plan?confirmed=${r.version}${r.inviteLinks.length ? "&invited=1" : ""}`);
}

export async function inviteExecutorAction(name: string, email: string) {
  const ctx = await requireRole("OWNER");
  const r = await inviteExecutor(ctx, name, email);
  revalidatePath("/plan");
  return r;
}

/** Step 1 of "something has happened": ask the contact's own passkey for a fresh check. */
export async function beginContactConfirmAction() {
  const ctx = await requireRole("TRUSTED_CONTACT");
  return beginStepUp(ctx.user.id, `CONTACT_CONFIRMED:${ctx.planId}`);
}

/**
 * Step 2: verified on the server. The state machine refuses any confirmation
 * not backed by a passkey check (THREAT_MODEL T1), and the owner is told at
 * once on every channel.
 */
export async function finishContactConfirmAction(challengeId: string, response: AuthenticationResponseJSON): Promise<{ ok: boolean; message?: string }> {
  const ctx = await requireRole("TRUSTED_CONTACT");
  const r = await tx(async (c) => {
    const verified = await finishStepUp(c, ctx.user.id, challengeId, `CONTACT_CONFIRMED:${ctx.planId}`, response);
    if (!verified) return { ok: false, message: "We couldn’t verify your passkey, so nothing has changed." };
    const applied = await applyEvent(c, ctx.planId, { type: "CONTACT_CONFIRMED", passkeyVerified: true, at: Date.now() }, ctx.user.id, {});
    if (applied.rejected) return { ok: false, message: "There’s nothing to confirm right now." };
    return { ok: true };
  });
  revalidatePath("/contact");
  return r;
}

export type DraftFromWords =
  | { ok: true; plan: unknown }
  | { ok: false; reason: "AI_OFF" | "PROVIDER_UNAVAILABLE" | "INVALID_OUTPUT"; issues?: string[] };

/** Drafts a plan from the owner's own words when an AI provider is configured. Never auto-confirms. */
export async function draftFromWordsAction(words: string, timeZone: string): Promise<DraftFromWords> {
  await requireRole("OWNER");
  const env = {
    AI_PROVIDER: process.env.AI_PROVIDER,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
  };
  const hasKey = env.AI_PROVIDER === "gemini" ? !!env.GEMINI_API_KEY : !!env.ANTHROPIC_API_KEY;
  if (!hasKey) return { ok: false, reason: "AI_OFF" };
  const { draftPlan, providerFromEnv } = await import("@lp/ai");
  const r = await draftPlan(providerFromEnv(env), words.slice(0, 4000), timeZone);
  if (!r.ok) return { ok: false, reason: r.reason, issues: r.issues };
  return { ok: true, plan: r.plan };
}

const PAYMENT_ACTIONS: readonly PaymentAction[] = ["stop", "ask-contact", "send-anyway", "cancel-release"];

export async function paymentAction(formData: FormData): Promise<void> {
  const ctx = await requireRole("OWNER");
  const id = String(formData.get("id") ?? "");
  const action = String(formData.get("action") ?? "") as PaymentAction;
  if (!PAYMENT_ACTIONS.includes(action)) throw new Error("Unknown action");
  await actOnPayment(ctx, id, action);
  revalidatePath(`/payments/${id}`);
  revalidatePath("/home");
}

export async function reissueInviteAction(role: "TRUSTED_CONTACT" | "EXECUTOR") {
  const ctx = await requireRole("OWNER");
  return reissueInvite(ctx, role);
}
