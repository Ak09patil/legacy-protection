/**
 * The vault's rules and cryptography, shared by the HTTP service and the
 * in-process vault used in tests and local development.
 *
 * Envelope encryption: each (plan, kind) has its own 256-bit data key. The
 * main database stores only ciphertext; the vault stores only data keys,
 * wrapped by a master key held outside both databases. To read a field, a
 * client asks the vault to release that plan's key *for a stated purpose*;
 * the vault checks the purpose against a fixed table, logs the request, and
 * rate-limits each client. (INV-24)
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const KINDS = ["payment_note", "plan_document"] as const;
export type Kind = (typeof KINDS)[number];

export const CLIENTS = ["web", "worker"] as const;
export type ClientId = (typeof CLIENTS)[number];

/**
 * Who may read what, and why. The worker runs the plan, so it can read plan
 * documents but never what scammers wrote to the owner. Not configurable at
 * runtime: a compromised app can't grant itself more.
 */
export const POLICY: Readonly<Record<Kind, Readonly<Record<ClientId, readonly string[]>>>> = {
  payment_note: { web: ["owner_view", "ai_helper"], worker: [] },
  plan_document: { web: ["owner_view", "contact_view", "executor_view", "confirm"], worker: ["run_plan"] },
};

export function isAllowed(client: ClientId, kind: Kind, purpose: string): boolean {
  return POLICY[kind][client].includes(purpose);
}

/** Unwraps per client per minute before the vault stops answering that client. */
export const RATE_LIMIT_PER_MINUTE = 600;

// ---------------------------------------------------------------------------
// AES-256-GCM
// ---------------------------------------------------------------------------

export function seal(key: Buffer, plain: Buffer, aad: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(aad));
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}

export function open(key: Buffer, sealed: Buffer, aad: string): Buffer {
  const d = createDecipheriv("aes-256-gcm", key, sealed.subarray(0, 12));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([d.update(sealed.subarray(28)), d.final()]);
}

export function masterKeyFrom(secret: string | undefined): Buffer {
  if (!secret || secret.length < 32) throw new Error("VAULT_MASTER_KEY must be at least 32 characters");
  return createHash("sha256").update(`lp-vault-master-v1:${secret}`).digest();
}

// ---------------------------------------------------------------------------
// Field format stored in the main database: lpv1.<keyId>.<base64url sealed>
// The additional data binds a ciphertext to its plan and kind, so it can't be
// copied onto another plan or read as another kind.
// ---------------------------------------------------------------------------

export const FIELD_PREFIX = "lpv1";

export function fieldAad(ownerRef: string, kind: Kind): string {
  return `${FIELD_PREFIX}|${ownerRef}|${kind}`;
}

export function encodeField(keyId: string, sealed: Buffer): string {
  return `${FIELD_PREFIX}.${keyId}.${sealed.toString("base64url")}`;
}

export function decodeField(value: string): { keyId: string; sealed: Buffer } {
  const [prefix, keyId, body] = value.split(".");
  if (prefix !== FIELD_PREFIX || !keyId || !body) throw new Error("Not a vault-sealed field");
  return { keyId, sealed: Buffer.from(body, "base64url") };
}

export function isSealedField(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(`${FIELD_PREFIX}.`);
}
