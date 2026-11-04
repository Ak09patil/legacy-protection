import "server-only";

/**
 * Accounts and sign-in. Passkeys only (WebAuthn, user verification required).
 * INV-22: session and invite tokens are stored as SHA-256 hashes; roles come
 * only from memberships created through the owner's invite.
 */

import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { appendEvent } from "@lp/db/audit";
import { z } from "zod";
import { db, tx, type Tx } from "./db";
import { sendEmail } from "./mail";

const SESSION_COOKIE = "lp_session";
const SESSION_DAYS = 30;
const CHALLENGE_TTL_MS = 5 * 60_000;
const INVITE_DAYS = 7;

export type Role = "OWNER" | "TRUSTED_CONTACT" | "EXECUTOR";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  memberships: Array<{ planId: string; role: Role; ownerName: string }>;
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const token = () => randomBytes(32).toString("base64url");

function relyingParty() {
  const origin = process.env.APP_ORIGIN ?? "http://localhost:3000";
  return { origin, rpID: new URL(origin).hostname, rpName: "Legacy Protection" };
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

async function createSession(c: Tx, userId: string): Promise<void> {
  const t = token();
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const ua = (await headers()).get("user-agent")?.slice(0, 200) ?? null;
  await c.query(`INSERT INTO sessions (token_hash, user_id, expires_at, user_agent) VALUES ($1, $2, $3, $4)`, [sha256(t), userId, expires, ua]);
  (await cookies()).set(SESSION_COOKIE, t, {
    httpOnly: true,
    secure: relyingParty().origin.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    expires,
  });
}

/** The signed-in person, or null. Never trusts anything but the session cookie. */
export async function currentUser(): Promise<SessionUser | null> {
  const t = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!t || t.length > 100) return null;
  const r = await db().query<{ id: string; email: string; display_name: string }>(
    `UPDATE sessions s SET last_seen_at = now()
       FROM users u
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.id = s.user_id
      RETURNING u.id, u.email, u.display_name`,
    [sha256(t)],
  );
  const u = r.rows[0];
  if (!u) return null;
  const m = await db().query<{ plan_id: string; role: Role; owner_name: string }>(
    `SELECT m.plan_id, m.role, o.display_name AS owner_name
       FROM memberships m JOIN plans p ON p.id = m.plan_id JOIN users o ON o.id = p.owner_id
      WHERE m.user_id = $1 AND m.revoked_at IS NULL
      ORDER BY m.role = 'OWNER' DESC, m.created_at`,
    [u.id],
  );
  return {
    id: u.id,
    email: u.email,
    name: u.display_name,
    memberships: m.rows.map((x) => ({ planId: x.plan_id, role: x.role, ownerName: x.owner_name })),
  };
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const t = jar.get(SESSION_COOKIE)?.value;
  if (t) await db().query(`DELETE FROM sessions WHERE token_hash = $1`, [sha256(t)]);
  jar.delete(SESSION_COOKIE);
}

// ---------------------------------------------------------------------------
// Challenges: single use, short lived
// ---------------------------------------------------------------------------

async function storeChallenge(purpose: "register" | "authenticate" | "confirm", challenge: string, userId: string | null, pending?: unknown) {
  const id = randomUUID();
  await db().query(`DELETE FROM auth_challenges WHERE expires_at < now()`);
  await db().query(
    `INSERT INTO auth_challenges (id, challenge, purpose, user_id, pending, expires_at) VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, challenge, purpose, userId, pending === undefined ? null : JSON.stringify(pending), new Date(Date.now() + CHALLENGE_TTL_MS)],
  );
  return id;
}

interface PendingAccount {
  userId: string;
  name: string;
  email: string;
  inviteToken?: string;
}

/** After the person is created: either accept their invite, or give them their own plan. */
async function setUpAccount(c: Tx, pending: PendingAccount): Promise<Role> {
  if (pending.inviteToken) {
    const accepted = await acceptInvite(c, pending.inviteToken, pending.userId);
    if (!accepted) throw new Error("INVITE_GONE");
    return accepted;
  }
  const planId = randomUUID();
  await c.query(`INSERT INTO plans (id, owner_id) VALUES ($1, $2)`, [planId, pending.userId]);
  await c.query(`INSERT INTO memberships (plan_id, user_id, role) VALUES ($1, $2, 'OWNER')`, [planId, pending.userId]);
  await appendEvent(c, { planId, at: new Date(), kind: "ACCOUNT_CREATED", actor: pending.userId, payload: { role: "OWNER" } });
  return "OWNER";
}

async function consumeChallenge(c: Tx, id: string, purpose: string) {
  const r = await c.query<{ challenge: string; user_id: string | null; pending: unknown }>(
    `DELETE FROM auth_challenges WHERE id = $1 AND purpose = $2 AND expires_at > now() RETURNING challenge, user_id, pending`,
    [id, purpose],
  );
  return r.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Sign up (new owner, or someone accepting an invite)
// ---------------------------------------------------------------------------

const SignUp = z.object({
  name: z.string().trim().min(1, "Please enter your name.").max(80),
  email: z.string().trim().toLowerCase().email("Please enter a valid email address.").max(200),
  inviteToken: z.string().max(100).optional(),
});

export type Result<T> = { ok: true; value: T } | { ok: false; message: string };

export async function beginSignUp(input: unknown): Promise<Result<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }>> {
  const p = SignUp.safeParse(input);
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? "Please check your details." };
  const { name, email, inviteToken } = p.data;
  if (inviteToken) {
    const inv = await openInvite(inviteToken);
    if (!inv) return { ok: false, message: "This invitation has expired or was already used. Ask for a new one." };
  }
  const exists = await db().query(`SELECT 1 FROM users WHERE lower(email) = $1`, [email]);
  if (exists.rowCount) return { ok: false, message: "There’s already an account with this email. Sign in instead." };

  const userId = randomUUID();
  const { rpID, rpName } = relyingParty();
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: email,
    userDisplayName: name,
    userID: new TextEncoder().encode(userId),
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  const challengeId = await storeChallenge("register", options.challenge, null, { userId, name, email, inviteToken });
  return { ok: true, value: { challengeId, options } };
}

export async function finishSignUp(challengeId: string, response: RegistrationResponseJSON): Promise<Result<{ role: Role }>> {
  const { origin, rpID } = relyingParty();
  try {
    return await tx(async (c) => {
      const ch = await consumeChallenge(c, challengeId, "register");
      if (!ch) return { ok: false as const, message: "That took too long. Please try again." };
      const pending = ch.pending as PendingAccount;
      const v = await verifyRegistrationResponse({
        response,
        expectedChallenge: ch.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
      if (!v.verified || !v.registrationInfo) return { ok: false as const, message: "We couldn’t verify your passkey." };
      const { credential, credentialDeviceType, credentialBackedUp } = v.registrationInfo;

      await c.query(`INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3)`, [pending.userId, pending.email, pending.name]);
      await c.query(
        `INSERT INTO passkeys (id, user_id, public_key, counter, transports, device_type, backed_up) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [credential.id, pending.userId, Buffer.from(credential.publicKey), credential.counter, credential.transports ?? [], credentialDeviceType, credentialBackedUp],
      );
      const role = await setUpAccount(c, pending);
      await createSession(c, pending.userId);
      return { ok: true as const, value: { role } };
    });
  } catch (e) {
    if (e instanceof Error && e.message === "INVITE_GONE") return { ok: false, message: "This invitation has expired or was already used." };
    if (e instanceof Error && /duplicate key/.test(e.message)) return { ok: false, message: "There’s already an account with this email. Sign in instead." };
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Sign in (discoverable passkey: no email needed)
// ---------------------------------------------------------------------------

export async function beginSignIn(): Promise<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }> {
  const options = await generateAuthenticationOptions({ rpID: relyingParty().rpID, userVerification: "required" });
  const challengeId = await storeChallenge("authenticate", options.challenge, null);
  return { challengeId, options };
}

export async function finishSignIn(challengeId: string, response: AuthenticationResponseJSON): Promise<Result<null>> {
  return tx(async (c) => {
    const ch = await consumeChallenge(c, challengeId, "authenticate");
    if (!ch) return { ok: false as const, message: "That took too long. Please try again." };
    const userId = await verifyPasskey(c, ch.challenge, response);
    if (!userId) return { ok: false as const, message: "We didn’t recognise that passkey." };
    await createSession(c, userId);
    return { ok: true as const, value: null };
  });
}

/** Verifies an assertion against a stored passkey and advances its counter. Returns the user id, or null. */
async function verifyPasskey(c: Tx, expectedChallenge: string, response: AuthenticationResponseJSON, mustBeUser?: string): Promise<string | null> {
  const { origin, rpID } = relyingParty();
  const pk = await c.query<{ id: string; user_id: string; public_key: Buffer; counter: string; transports: string[] }>(
    `SELECT id, user_id, public_key, counter, transports FROM passkeys WHERE id = $1 FOR UPDATE`,
    [response.id],
  );
  const row = pk.rows[0];
  if (!row || (mustBeUser && row.user_id !== mustBeUser)) return null;
  const v = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: {
      id: row.id,
      publicKey: new Uint8Array(row.public_key),
      counter: Number(row.counter),
      transports: row.transports as AuthenticatorTransportFuture[],
    },
  }).catch(() => null);
  if (!v?.verified) return null;
  await c.query(`UPDATE passkeys SET counter = $2, last_used_at = now() WHERE id = $1`, [row.id, v.authenticationInfo.newCounter]);
  return row.user_id;
}

// ---------------------------------------------------------------------------
// Step-up: a fresh passkey check for one serious action (e.g. "something has happened")
// ---------------------------------------------------------------------------

export async function beginStepUp(userId: string, action: string): Promise<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }> {
  const creds = await db().query<{ id: string; transports: string[] }>(`SELECT id, transports FROM passkeys WHERE user_id = $1`, [userId]);
  const options = await generateAuthenticationOptions({
    rpID: relyingParty().rpID,
    userVerification: "required",
    allowCredentials: creds.rows.map((r) => ({ id: r.id, transports: r.transports as AuthenticatorTransportFuture[] })),
  });
  const challengeId = await storeChallenge("confirm", options.challenge, userId, { action });
  return { challengeId, options };
}

/** True only if this exact user just passed a passkey check for this exact action. */
export async function finishStepUp(c: Tx, userId: string, challengeId: string, action: string, response: AuthenticationResponseJSON): Promise<boolean> {
  const ch = await consumeChallenge(c, challengeId, "confirm");
  if (!ch || ch.user_id !== userId || (ch.pending as { action?: string } | null)?.action !== action) return false;
  return (await verifyPasskey(c, ch.challenge, response, userId)) === userId;
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

export async function createInvite(c: Tx, planId: string, invitedBy: string, role: "TRUSTED_CONTACT" | "EXECUTOR", name: string, email: string): Promise<string> {
  await c.query(`UPDATE invites SET revoked_at = now() WHERE plan_id = $1 AND role = $2 AND accepted_at IS NULL AND revoked_at IS NULL`, [planId, role]);
  const t = token();
  await c.query(
    `INSERT INTO invites (token_hash, plan_id, role, email, name, invited_by, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [sha256(t), planId, role, email.toLowerCase(), name, invitedBy, new Date(Date.now() + INVITE_DAYS * 86_400_000)],
  );
  return `${relyingParty().origin}/invite/${t}`;
}

export async function openInvite(t: string) {
  const r = await db().query<{ plan_id: string; role: Role; email: string; name: string; owner_name: string }>(
    `SELECT i.plan_id, i.role, i.email, i.name, o.display_name AS owner_name
       FROM invites i JOIN plans p ON p.id = i.plan_id JOIN users o ON o.id = p.owner_id
      WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()`,
    [sha256(t)],
  );
  return r.rows[0] ?? null;
}

async function acceptInvite(c: Tx, t: string, userId: string): Promise<Role | null> {
  const r = await c.query<{ plan_id: string; role: Role }>(
    `UPDATE invites SET accepted_at = now(), accepted_by = $2
      WHERE token_hash = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
      RETURNING plan_id, role`,
    [sha256(t), userId],
  );
  const inv = r.rows[0];
  if (!inv) return null;
  await c.query(`UPDATE memberships SET revoked_at = now() WHERE plan_id = $1 AND role = $2 AND revoked_at IS NULL`, [inv.plan_id, inv.role]);
  await c.query(`INSERT INTO memberships (plan_id, user_id, role) VALUES ($1, $2, $3)`, [inv.plan_id, userId, inv.role]);
  await appendEvent(c, { planId: inv.plan_id, at: new Date(), kind: "INVITE_ACCEPTED", actor: userId, payload: { role: inv.role } });
  return inv.role;
}

/** Signed-in person accepting an invite with their existing account. */
export async function acceptInviteAsUser(t: string, userId: string): Promise<Role | null> {
  return tx((c) => acceptInvite(c, t, userId));
}

// ---------------------------------------------------------------------------
// Email codes: the fallback for people who can't use passkeys
// ---------------------------------------------------------------------------

const CODE_TTL_MS = 10 * 60_000;
const CODE_MAX_ATTEMPTS = 5;
const CODES_PER_15_MIN = 3;

function codeHmac(id: string, code: string): string {
  const secret = process.env.APP_SECRET;
  if (!secret) throw new Error("APP_SECRET is not set");
  return createHmac("sha256", secret).update(`${id}:${code}`).digest("hex");
}

async function issueCode(purpose: "signup" | "signin" | "confirm", email: string, pending: unknown, deliver: boolean): Promise<Result<{ codeId: string }>> {
  const recent = await db().query<{ n: string }>(
    `SELECT count(*) AS n FROM email_codes WHERE lower(email) = $1 AND created_at > now() - interval '15 minutes'`,
    [email],
  );
  if (Number(recent.rows[0]?.n ?? 0) >= CODES_PER_15_MIN) return { ok: false, message: "Too many codes requested. Please wait a few minutes." };
  const id = randomUUID();
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db().query(
    `INSERT INTO email_codes (id, email, purpose, code_hmac, pending, expires_at) VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, email, purpose, codeHmac(id, code), pending === undefined ? null : JSON.stringify(pending), new Date(Date.now() + CODE_TTL_MS)],
  );
  if (deliver) {
    await sendEmail(email, `Your Legacy Protection code: ${code}`, `Your code is ${code}. It works once, for 10 minutes.\n\nIf you didn’t ask for this, you can ignore this email. Nobody can use it without your email inbox.`);
  }
  return { ok: true, value: { codeId: id } };
}

async function redeemCode(c: Tx, id: string, code: string, purpose: string): Promise<{ email: string; pending: unknown } | null> {
  const r = await c.query<{ email: string; purpose: string; code_hmac: string; pending: unknown; attempts: number; expires_at: Date; consumed_at: Date | null }>(
    `SELECT email, purpose, code_hmac, pending, attempts, expires_at, consumed_at FROM email_codes WHERE id = $1 FOR UPDATE`,
    [id],
  );
  const row = r.rows[0];
  if (!row || row.purpose !== purpose || row.consumed_at || row.expires_at.getTime() < Date.now() || row.attempts >= CODE_MAX_ATTEMPTS) return null;
  const want = Buffer.from(row.code_hmac, "hex");
  const got = Buffer.from(codeHmac(id, code.replace(/\D/g, "").slice(0, 6)), "hex");
  if (want.length !== got.length || !timingSafeEqual(want, got)) {
    await c.query(`UPDATE email_codes SET attempts = attempts + 1 WHERE id = $1`, [id]);
    return null;
  }
  await c.query(`UPDATE email_codes SET consumed_at = now() WHERE id = $1`, [id]);
  return { email: row.email, pending: row.pending };
}

export async function beginSignUpWithCode(input: unknown): Promise<Result<{ codeId: string }>> {
  const p = SignUp.safeParse(input);
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? "Please check your details." };
  const { name, email, inviteToken } = p.data;
  if (inviteToken && !(await openInvite(inviteToken))) return { ok: false, message: "This invitation has expired or was already used. Ask for a new one." };
  const exists = await db().query(`SELECT 1 FROM users WHERE lower(email) = $1`, [email]);
  if (exists.rowCount) return { ok: false, message: "There’s already an account with this email. Sign in instead." };
  return issueCode("signup", email, { userId: randomUUID(), name, email, inviteToken } satisfies PendingAccount, true);
}

export async function finishSignUpWithCode(codeId: string, code: string): Promise<Result<{ role: Role }>> {
  try {
    return await tx(async (c) => {
      const ok = await redeemCode(c, codeId, code, "signup");
      if (!ok) return { ok: false as const, message: "That code isn’t right, or it has expired." };
      const pending = ok.pending as PendingAccount;
      await c.query(`INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3)`, [pending.userId, pending.email, pending.name]);
      const role = await setUpAccount(c, pending);
      await createSession(c, pending.userId);
      return { ok: true as const, value: { role } };
    });
  } catch (e) {
    if (e instanceof Error && e.message === "INVITE_GONE") return { ok: false, message: "This invitation has expired or was already used." };
    if (e instanceof Error && /duplicate key/.test(e.message)) return { ok: false, message: "There’s already an account with this email. Sign in instead." };
    throw e;
  }
}

/** Always answers the same way, so it can't be used to find out who has an account. */
export async function beginSignInWithCode(emailInput: string): Promise<Result<{ codeId: string }>> {
  const email = emailInput.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, message: "Please enter a valid email address." };
  const exists = await db().query(`SELECT 1 FROM users WHERE lower(email) = $1`, [email]);
  return issueCode("signin", email, undefined, (exists.rowCount ?? 0) > 0);
}

export async function finishSignInWithCode(codeId: string, code: string): Promise<Result<null>> {
  return tx(async (c) => {
    const ok = await redeemCode(c, codeId, code, "signin");
    if (!ok) return { ok: false as const, message: "That code isn’t right, or it has expired." };
    const u = await c.query<{ id: string }>(`SELECT id FROM users WHERE lower(email) = $1`, [ok.email]);
    if (!u.rows[0]) return { ok: false as const, message: "That code isn’t right, or it has expired." };
    await createSession(c, u.rows[0].id);
    return { ok: true as const, value: null };
  });
}

/** Step-up by email code, for people without a passkey. Weaker than a passkey; documented in THREAT_MODEL T1. */
export async function beginStepUpWithCode(user: { id: string; email: string }, action: string): Promise<Result<{ codeId: string }>> {
  return issueCode("confirm", user.email.toLowerCase(), { userId: user.id, action }, true);
}

export async function finishStepUpWithCode(c: Tx, userId: string, codeId: string, code: string, action: string): Promise<boolean> {
  const ok = await redeemCode(c, codeId, code, "confirm");
  const p = ok?.pending as { userId?: string; action?: string } | undefined;
  return !!ok && p?.userId === userId && p?.action === action;
}

export async function hasPasskey(userId: string): Promise<boolean> {
  const r = await db().query(`SELECT 1 FROM passkeys WHERE user_id = $1 LIMIT 1`, [userId]);
  return (r.rowCount ?? 0) > 0;
}
