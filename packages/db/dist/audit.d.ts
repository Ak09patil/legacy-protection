/**
 * Append-only, hash-chained audit log. INV-15, ADR-0003.
 *
 * Each event's hash = sha256(prev_hash + canonical JSON of its content).
 * The database independently checks every new event links to the previous
 * one and rejects updates and deletes. `verifyChain` recomputes everything
 * and reports the first broken link.
 */
import type pg from "pg";
export declare const GENESIS_HASH: string;
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
export declare function canonicalJson(value: unknown): string;
export declare function hashEvent(prevHash: string, e: Omit<AuditEvent, "prevHash" | "hash">): string;
type Queryable = Pick<pg.Client, "query">;
/**
 * Runs fn inside a transaction. The client must be dedicated to this
 * transaction (e.g. checked out of a pool); never run concurrent transactions
 * on one connection, or their statements interleave.
 */
export declare function withTransaction<T>(client: Queryable, fn: (tx: Queryable) => Promise<T>): Promise<T>;
/**
 * Appends one event. MUST be called inside a transaction (see withTransaction),
 * so the audit entry commits atomically with the state change it records.
 *
 * A transaction-scoped advisory lock per plan serialises writers for the same
 * plan; writers for different plans never wait on each other. No retries, no
 * livelock under contention.
 */
export declare function appendEvent(tx: Queryable, input: AuditEventInput): Promise<AuditEvent>;
/** Convenience for callers with nothing else to commit alongside the event. */
export declare function appendEventTx(client: Queryable, input: AuditEventInput): Promise<AuditEvent>;
export type ChainVerdict = {
    readonly ok: true;
    readonly length: number;
    readonly head: string;
} | {
    readonly ok: false;
    readonly brokenAtSeq: number;
    readonly reason: string;
};
export declare function verifyChain(db: Queryable, planId: string): Promise<ChainVerdict>;
export {};
