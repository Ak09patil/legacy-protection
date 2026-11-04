"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  actOnPayment,
  checkIn,
  confirmPlan,
  contactConfirm,
  previewPlan,
  resetWorld,
  storyFinishWaiting,
  storyMissCheckins,
  type PaymentAction,
} from "@/server/world";

const ALL = ["/home", "/plan", "/contact", "/executor", "/ops"];
function refreshAll() {
  for (const p of ALL) revalidatePath(p);
  revalidatePath("/payments/[id]", "page");
}

export async function checkInAction(): Promise<void> {
  checkIn();
  refreshAll();
}

const ACTIONS: readonly PaymentAction[] = ["stop", "ask-contact", "send-anyway", "cancel-release"];

export async function paymentAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const action = String(formData.get("action") ?? "") as PaymentAction;
  if (!ACTIONS.includes(action)) throw new Error("Unknown action");
  actOnPayment(id, action);
  revalidatePath(`/payments/${id}`);
  revalidatePath("/home");
  revalidatePath("/contact");
}

export async function previewPlanAction(plan: unknown) {
  return previewPlan(plan);
}

export async function confirmPlanAction(plan: unknown) {
  const r = confirmPlan(plan);
  if (!r.ok) return r;
  revalidatePath("/plan");
  revalidatePath("/home");
  redirect("/plan?confirmed=1");
}

export type DraftFromWords =
  | { ok: true; plan: unknown }
  | { ok: false; reason: "AI_OFF" | "PROVIDER_UNAVAILABLE" | "INVALID_OUTPUT"; issues?: string[] };

/** Drafts a plan from the owner's own words when an AI provider is configured. Never auto-confirms. */
export async function draftFromWordsAction(words: string, timeZone: string): Promise<DraftFromWords> {
  const { draftPlan, providerFromEnv } = await import("@lp/ai");
  const env = {
    AI_PROVIDER: process.env.AI_PROVIDER,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
  };
  const hasKey = env.AI_PROVIDER === "scripted" || (env.AI_PROVIDER === "gemini" ? !!env.GEMINI_API_KEY : !!env.ANTHROPIC_API_KEY);
  if (!hasKey) return { ok: false, reason: "AI_OFF" };
  let provider;
  try {
    provider = providerFromEnv(env);
  } catch {
    return { ok: false, reason: "AI_OFF" };
  }
  const r = await draftPlan(provider, words.slice(0, 4000), timeZone);
  if (!r.ok) return { ok: false, reason: r.reason, issues: r.issues };
  return { ok: true, plan: r.plan };
}

export async function contactConfirmAction(passkeyVerified: boolean): Promise<{ ok: boolean; reason?: string }> {
  const r = contactConfirm(passkeyVerified);
  refreshAll();
  return r ? { ok: false, reason: r } : { ok: true };
}

/** Judge mode: move the story forward one step, or start again. */
export async function storyAction(step: "missed" | "confirm" | "wait" | "reset"): Promise<{ ok: boolean; reason?: string }> {
  let r: string | null = null;
  if (step === "missed") r = storyMissCheckins();
  else if (step === "confirm") r = contactConfirm(true);
  else if (step === "wait") r = storyFinishWaiting();
  else resetWorld();
  refreshAll();
  return r ? { ok: false, reason: r } : { ok: true };
}
