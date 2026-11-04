import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** AES-256-GCM with a key derived from APP_SECRET, which never lives in the database. */
function key(): Buffer {
  const s = process.env.APP_SECRET;
  if (!s || s.length < 32) throw new Error("APP_SECRET must be set to at least 32 characters");
  return createHash("sha256").update(`lp-seal-v1:${s}`).digest();
}

export function seal(plain: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}

export function unseal(sealed: Buffer): string {
  const d = createDecipheriv("aes-256-gcm", key(), sealed.subarray(0, 12));
  d.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([d.update(sealed.subarray(28)), d.final()]).toString("utf8");
}
