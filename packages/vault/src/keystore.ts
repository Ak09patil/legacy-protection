/**
 * Data keys and the access log, on the vault's own Postgres database.
 */

import { randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import { isAllowed, open, RATE_LIMIT_PER_MINUTE, seal, type ClientId, type Kind } from "./core.js";

export type ReleaseResult =
  | { ok: true; keyId: string; key: Buffer }
  | { ok: false; reason: "PURPOSE_NOT_ALLOWED" | "UNKNOWN_KEY" | "WRONG_KIND" | "RATE_LIMITED" };

export class KeyStore {
  constructor(
    private readonly db: pg.Pool,
    private readonly master: Buffer,
  ) {}

  private wrapAad(id: string, ownerRef: string, kind: Kind) {
    return `wrap|${id}|${ownerRef}|${kind}`;
  }

  private async log(client: ClientId, keyId: string | null, kind: string, purpose: string, allowed: boolean, reason: string | null) {
    await this.db.query(`INSERT INTO access_log (client, key_id, kind, purpose, allowed, reason) VALUES ($1, $2, $3, $4, $5, $6)`, [client, keyId, kind, purpose, allowed, reason]);
  }

  private async rateLimited(client: ClientId): Promise<boolean> {
    const r = await this.db.query<{ n: string }>(`SELECT count(*) AS n FROM access_log WHERE client = $1 AND at > now() - interval '1 minute'`, [client]);
    return Number(r.rows[0]?.n ?? 0) >= RATE_LIMIT_PER_MINUTE;
  }

  /** The key a client should encrypt new data with. Writing needs a purpose too. */
  async keyForWrite(client: ClientId, ownerRef: string, kind: Kind, purpose: string): Promise<ReleaseResult> {
    if (!isAllowed(client, kind, purpose)) {
      await this.log(client, null, kind, purpose, false, "PURPOSE_NOT_ALLOWED");
      return { ok: false, reason: "PURPOSE_NOT_ALLOWED" };
    }
    if (await this.rateLimited(client)) {
      await this.log(client, null, kind, purpose, false, "RATE_LIMITED");
      return { ok: false, reason: "RATE_LIMITED" };
    }
    const existing = await this.db.query<{ id: string; wrapped: Buffer }>(`SELECT id, wrapped FROM data_keys WHERE owner_ref = $1 AND kind = $2`, [ownerRef, kind]);
    let id: string;
    let key: Buffer;
    if (existing.rows[0]) {
      id = existing.rows[0].id;
      key = open(this.master, existing.rows[0].wrapped, this.wrapAad(id, ownerRef, kind));
    } else {
      id = randomUUID();
      key = randomBytes(32);
      const ins = await this.db.query(
        `INSERT INTO data_keys (id, owner_ref, kind, wrapped) VALUES ($1, $2, $3, $4) ON CONFLICT (owner_ref, kind) DO NOTHING`,
        [id, ownerRef, kind, seal(this.master, key, this.wrapAad(id, ownerRef, kind))],
      );
      if (ins.rowCount === 0) {
        // Lost a race with another writer: use the key that won.
        const won = await this.db.query<{ id: string; wrapped: Buffer }>(`SELECT id, wrapped FROM data_keys WHERE owner_ref = $1 AND kind = $2`, [ownerRef, kind]);
        id = won.rows[0]!.id;
        key = open(this.master, won.rows[0]!.wrapped, this.wrapAad(id, ownerRef, kind));
      }
    }
    await this.log(client, id, kind, purpose, true, null);
    return { ok: true, keyId: id, key };
  }

  async keyForRead(client: ClientId, keyId: string, kind: Kind, purpose: string): Promise<ReleaseResult> {
    if (!isAllowed(client, kind, purpose)) {
      await this.log(client, null, kind, purpose, false, "PURPOSE_NOT_ALLOWED");
      return { ok: false, reason: "PURPOSE_NOT_ALLOWED" };
    }
    if (await this.rateLimited(client)) {
      await this.log(client, null, kind, purpose, false, "RATE_LIMITED");
      return { ok: false, reason: "RATE_LIMITED" };
    }
    const r = await this.db.query<{ owner_ref: string; kind: string; wrapped: Buffer }>(`SELECT owner_ref, kind, wrapped FROM data_keys WHERE id = $1`, [keyId]);
    const row = r.rows[0];
    if (!row) {
      await this.log(client, null, kind, purpose, false, "UNKNOWN_KEY");
      return { ok: false, reason: "UNKNOWN_KEY" };
    }
    if (row.kind !== kind) {
      await this.log(client, keyId, kind, purpose, false, "WRONG_KIND");
      return { ok: false, reason: "WRONG_KIND" };
    }
    const key = open(this.master, row.wrapped, this.wrapAad(keyId, row.owner_ref, kind));
    await this.log(client, keyId, kind, purpose, true, null);
    return { ok: true, keyId, key };
  }
}
