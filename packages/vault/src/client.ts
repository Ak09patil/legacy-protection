/**
 * How the app and the worker use the vault. They never see the master key
 * or the vault's database; they get one plan's key for one purpose, use it,
 * and keep it in memory for at most a minute.
 */

import { decodeField, encodeField, fieldAad, isSealedField, open, seal, type ClientId, type Kind } from "./core.js";
import type { KeyStore } from "./keystore.js";
import { signRequest } from "./server.js";

export interface Vault {
  /** Encrypts a field for one plan. */
  sealField(ownerRef: string, kind: Kind, plain: string, purpose: string): Promise<string>;
  /** Decrypts a field. Plain (legacy, unsealed) values pass through unchanged. */
  openField(ownerRef: string, kind: Kind, value: string, purpose: string): Promise<string>;
}

export class VaultRefused extends Error {
  constructor(readonly reason: string) {
    super(`Vault refused: ${reason}`);
    this.name = "VaultRefused";
  }
}

type KeySource = {
  write(ownerRef: string, kind: Kind, purpose: string): Promise<{ keyId: string; key: Buffer }>;
  read(keyId: string, kind: Kind, purpose: string): Promise<{ keyId: string; key: Buffer }>;
};

const CACHE_MS = 60_000;

class EnvelopeVault implements Vault {
  private cache = new Map<string, { key: Buffer; until: number }>();
  constructor(private readonly src: KeySource) {}

  private cached(k: string) {
    const c = this.cache.get(k);
    return c && c.until > Date.now() ? c.key : null;
  }

  async sealField(ownerRef: string, kind: Kind, plain: string, purpose: string): Promise<string> {
    const { keyId, key } = await this.src.write(ownerRef, kind, purpose);
    return encodeField(keyId, seal(key, Buffer.from(plain, "utf8"), fieldAad(ownerRef, kind)));
  }

  async openField(ownerRef: string, kind: Kind, value: string, purpose: string): Promise<string> {
    if (!isSealedField(value)) return value;
    const { keyId, sealed } = decodeField(value);
    const cacheKey = `${keyId}|${kind}|${purpose}`;
    let key = this.cached(cacheKey);
    if (!key) {
      key = (await this.src.read(keyId, kind, purpose)).key;
      this.cache.set(cacheKey, { key, until: Date.now() + CACHE_MS });
    }
    return open(key, sealed, fieldAad(ownerRef, kind)).toString("utf8");
  }
}

/** The real thing: a separate service with its own database. */
export function httpVault(baseUrl: string, client: ClientId, secret: string): Vault {
  const call = async (path: string, body: object) => {
    const json = JSON.stringify(body);
    const ts = String(Date.now());
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-vault-client": client,
        "x-vault-timestamp": ts,
        "x-vault-signature": signRequest(secret, "POST", path, ts, json),
      },
      body: json,
      signal: AbortSignal.timeout(3000),
    });
    const out = (await res.json().catch(() => ({}))) as { keyId?: string; key?: string; error?: string };
    if (!res.ok || !out.keyId || !out.key) throw new VaultRefused(out.error ?? `status ${res.status}`);
    return { keyId: out.keyId, key: Buffer.from(out.key, "base64") };
  };
  return new EnvelopeVault({
    write: (ownerRef, kind, purpose) => call("/v1/keys/write", { ownerRef, kind, purpose }),
    read: (keyId, kind, purpose) => call("/v1/keys/read", { keyId, kind, purpose }),
  });
}

/** Same rules and logging, in process. For tests, and local development without the vault service. */
export function localVault(store: KeyStore, client: ClientId): Vault {
  const unwrap = async (p: Promise<Awaited<ReturnType<KeyStore["keyForRead"]>>>) => {
    const r = await p;
    if (!r.ok) throw new VaultRefused(r.reason);
    return { keyId: r.keyId, key: r.key };
  };
  return new EnvelopeVault({
    write: (ownerRef, kind, purpose) => unwrap(store.keyForWrite(client, ownerRef, kind, purpose)),
    read: (keyId, kind, purpose) => unwrap(store.keyForRead(client, keyId, kind, purpose)),
  });
}

/**
 * Local development only, when no vault service is configured: stores fields
 * unsealed and says so loudly. Refused in production.
 */
export function unsealedDevVault(): Vault {
  if (process.env.NODE_ENV === "production" && !process.env.ALLOW_UNSEALED_DEV_VAULT) {
    throw new Error("VAULT_URL must be set in production");
  }
  console.warn("[vault] VAULT_URL is not set: sensitive fields are stored UNSEALED (local development only).");
  return {
    async sealField(_o, _k, plain) {
      return plain;
    },
    async openField(_o, _k, value) {
      if (isSealedField(value)) throw new VaultRefused("NO_VAULT_CONFIGURED");
      return value;
    },
  };
}

/** Plan documents and steps are JSON; when sealed they're stored as {"sealed": "lpv1..."}. */
export async function sealJson(vault: Vault, ownerRef: string, kind: Kind, value: unknown, purpose: string): Promise<unknown> {
  const s = await vault.sealField(ownerRef, kind, JSON.stringify(value), purpose);
  return isSealedField(s) ? { sealed: s } : value;
}

export async function openJson(vault: Vault, ownerRef: string, kind: Kind, stored: unknown, purpose: string): Promise<unknown> {
  const s = (stored as { sealed?: unknown } | null)?.sealed;
  return isSealedField(s) ? JSON.parse(await vault.openField(ownerRef, kind, s, purpose)) : stored;
}
