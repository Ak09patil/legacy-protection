"use server";

import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { redirect } from "next/navigation";
import { beginSignIn, beginSignUp, finishSignIn, finishSignUp, signOut, type Role } from "@/server/auth";

export async function beginSignUpAction(input: { name: string; email: string; inviteToken?: string }) {
  return beginSignUp(input);
}

export async function finishSignUpAction(challengeId: string, response: RegistrationResponseJSON) {
  const r = await finishSignUp(challengeId, response);
  if (!r.ok) return r;
  redirect(homeFor(r.value.role));
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
