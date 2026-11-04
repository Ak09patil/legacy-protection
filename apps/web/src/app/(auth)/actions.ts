"use server";

import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { redirect } from "next/navigation";
import {
  beginSignIn,
  beginSignInWithCode,
  beginSignUp,
  beginSignUpWithCode,
  finishSignIn,
  finishSignInWithCode,
  finishSignUp,
  finishSignUpWithCode,
  signOut,
  type Role,
} from "@/server/auth";

export async function beginSignUpAction(input: { name: string; email: string; inviteToken?: string }) {
  return beginSignUp(input);
}

export async function finishSignUpAction(challengeId: string, response: RegistrationResponseJSON) {
  const r = await finishSignUp(challengeId, response);
  if (!r.ok) return r;
  redirect(homeFor(r.value.role));
}

export async function beginSignUpWithCodeAction(input: { name: string; email: string; inviteToken?: string }) {
  return beginSignUpWithCode(input);
}

export async function finishSignUpWithCodeAction(codeId: string, code: string) {
  const r = await finishSignUpWithCode(codeId, code);
  if (!r.ok) return r;
  redirect(homeFor(r.value.role));
}

export async function beginSignInWithCodeAction(email: string) {
  return beginSignInWithCode(email);
}

export async function finishSignInWithCodeAction(codeId: string, code: string) {
  const r = await finishSignInWithCode(codeId, code);
  if (!r.ok) return r;
  redirect("/home");
}

export async function beginSignInAction() {
  return beginSignIn();
}

export async function finishSignInAction(challengeId: string, response: AuthenticationResponseJSON) {
  const r = await finishSignIn(challengeId, response);
  if (!r.ok) return r;
  redirect("/home");
}

export async function signOutAction() {
  await signOut();
  redirect("/signin");
}

function homeFor(role: Role): string {
  return role === "OWNER" ? "/plan/edit" : role === "TRUSTED_CONTACT" ? "/contact" : "/executor";
}
