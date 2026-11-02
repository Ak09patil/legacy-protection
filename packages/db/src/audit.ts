/**
 * Append-only, hash-chained audit log. INV-15, ADR-0003.
 *
 * Each event's hash = sha256(prev_hash + canonical JSON of its content).
 * The database independently checks every new event links to the previous
 * one and rejects updates and deletes. `verifyChain` recomputes everything
 * and reports the first broken link.
 */

import { createHash } from "node:crypto";
import type pg from "pg";

export const GENESIS_HASH = "0".repeat(64);

export interface AuditEventInput {
  readonly planId: string;
  readonly at: Date;
  readonly kind: string;
  readonly actor: string;
  readonly payload: Record<string, unknown>;
}

export interface AuditEvent extends AuditEventInput {
  readonly seq: number;
  readonly prevHash: string;
  readonly hash: string;
}

/** Deterministic JSON: sorted keys, no whitespace, bigints as strings. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "bigint") return JSON.stringify(value.toString());
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Non-finite number in audit payload");
    if (value === undefined) return "null";
    return JSON.stringify(value);
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function hashEvent(prevHash: string, e: Omit<AuditEvent, "prevHash" | "hash">): string {
  const content = canonicalJson({
    planId: e.planId,
    seq: e.seq,
    at: e.at.toISOString(),
    kind: e.kind,
    actor: e.actor,
    payload: e.payload,
  });
  return createHash("sha256").update(prevHash).update(content).digest("hex");
}

type Queryable = Pick<pg.Client, "query">;

/**
 * Runs fn inside a transaction. The client must be dedicated to this
 * transaction (e.g. checked out of a pool); never run concurrent transactions
 * on one connection, or their statements interleave.
 */
export async function withTransaction<T>(client: Queryable, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  await client.query("BEGIN");
  try {
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}

/**
 * Appends one event. MUST be called inside a transaction (see withTransaction),
 * so the audit entry commits atomically with the state change it records.
 *
 * A transaction-scoped advisory lock per plan serialises writers for the same
 * plan; writers for different plans never wait on each other. No retries, no
 * livelock under contention.
 */
export async function appendEvent(tx: Queryable, input: AuditEventInput): Promise<AuditEvent> {
  await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`, [input.planId]);
  const tail = await tx.query<{ seq: number; hash: string }>(
    `SELECT seq, hash FROM audit_events WHERE plan_id = $1 ORDER BY seq DESC LIMIT 1`,
    [input.planId],
  );
  const prevHash = tail.rows[0]?.hash ?? GENESIS_HASH;
  const seq = (tail.rows[0]?.seq ?? 0) + 1;
  // Normalise the payload exactly as it will be read back, so the hash matches on verification.
  const payload = JSON.parse(canonicalJson(input.payload)) as Record<string, unknown>;
  const at = new Date(Math.floor(input.at.getTime()));
  const hash = hashEvent(prevHash, { ...input, at, payload, seq });
  await tx.query(
    `INSERT INTO audit_events (plan_id, seq, at, kind, actor, payload, prev_hash, hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [input.planId, seq, at, input.kind, input.actor, canonicalJson(payload), prevHash, hash],
  );
  return { ...input, at, payload, seq, prevHash, hash };
}

/** Convenience for callers with nothing else to commit alongside the event. */
export function appendEventTx(client: Queryable, input: AuditEventInput): Promise<AuditEvent> {
  return withTransaction(client, (tx) => appendEvent(tx, input));
}

export type ChainVerdict =
  | { readonly ok: true; readonly length: number; readonly head: string }
  | { readonly ok: false; readonly brokenAtSeq: number; readonly reason: string };

export async function verifyChain(db: Queryable, planId: string): Promise<ChainVerdict> {
  const rows = await db.query<{
    seq: number;
    at: Date;
    kind: string;
    actor: string;
    payload: Record<string, unknown>;
    prev_hash: string;
    hash: string;
  }>(
    `SELECT seq, at, kind, actor, payload, prev_hash, hash FROM audit_events WHERE plan_id = $1 ORDER BY seq`,
    [planId],
  );

  let prev = GENESIS_HASH;
  let expectedSeq = 1;
  for (const r of rows.rows) {
    if (r.seq !== expectedSeq) return { ok: false, brokenAtSeq: expectedSeq, reason: "missing event" };
    if (r.prev_hash !== prev) return { ok: false, brokenAtSeq: r.seq, reason: "link does not match previous hash" };
    const recomputed = hashEvent(prev, {
      planId,
      seq: r.seq,
      at: r.at,
      kind: r.kind,
      actor: r.actor,
      payload: r.payload,
    });
    if (recomputed !== r.hash) return { ok: false, brokenAtSeq: r.seq, reason: "content does not match its hash" };
    prev = r.hash;
    expectedSeq++;
  }
  return { ok: true, length: rows.rows.length, head: prev };
}
