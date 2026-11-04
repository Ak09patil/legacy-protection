/**
 * Time-driven steps of a plan, called by the Temporal worker when a timer
 * fires. Each function re-reads the database and re-checks the condition
 * before acting, so a late, duplicated or replayed timer can never move a
 * plan that shouldn't move (INV-06, INV-07, INV-20).
 */

import { EMAILS, emailLocale } from "./emails.js";
import { DEFAULT_POLICY, deadlines, isMissed, nextDue, type CheckinPolicy, type Phase } from "@lp/core";
import { appendEvent } from "@lp/db/audit";
import { PlanDocumentSchema, type PlanDocument } from "@lp/policy";
import type pg from "pg";
import { openJson } from "@lp/vault";
import { applyEvent, outbox, type StateRow, type Tx } from "./lifecycle.js";
import { serviceVault } from "./vault.js";

export async function inTx<T>(pool: pg.Pool, fn: (c: Tx) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

export interface Timeline {
  phase: Phase;
  checkinsMissed: boolean;
  contactConfirmed: boolean;
  lastCheckinAt: number | null;
  /** The current check-in window, while monitoring. */
  window: { dueAt: number; reminders: number[]; missedAt: number } | null;
  waitingEndsAt: number | null;
}

/** The confirmed plan, opened from the vault for running the plan (INV-24). */
export async function confirmedPlan(q: Pick<pg.Pool, "query">, planVersionId: string | null): Promise<PlanDocument | null> {
  if (!planVersionId) return null;
  const r = await q.query<{ plan_id: string; document: unknown }>(`SELECT plan_id, document FROM plan_versions WHERE id = $1`, [planVersionId]);
  const row = r.rows[0];
  if (!row) return null;
  return PlanDocumentSchema.parse(await openJson(serviceVault(), row.plan_id, "plan_document", row.document, "run_plan"));
}

export function policyFor(plan: PlanDocument): CheckinPolicy {
  return { ...DEFAULT_POLICY, ...plan.checkin };
}

export async function loadTimeline(pool: pg.Pool, planId: string): Promise<Timeline | null> {
  const r = await pool.query<StateRow>(`SELECT * FROM plan_state WHERE plan_id = $1`, [planId]);
  const s = r.rows[0];
  if (!s) return null;
  const plan = await confirmedPlan(pool, s.plan_version_id);
  const last = s.last_checkin_at?.getTime() ?? null;
  let window: Timeline["window"] = null;
  if (plan && last !== null && s.phase === "MONITORING" && !s.checkins_missed) {
    const p = policyFor(plan);
    const d = deadlines(nextDue(last, p), p);
    window = { dueAt: d.dueAt, reminders: [...d.reminders], missedAt: d.missedAt };
  }
  return {
    phase: s.phase,
    checkinsMissed: s.checkins_missed,
    contactConfirmed: s.contact_confirmed,
    lastCheckinAt: last,
    window,
    waitingEndsAt: s.waiting_started_at ? s.waiting_started_at.getTime() + Number(s.waiting_period_ms) : null,
  };
}

async function people(c: Tx, planId: string) {
  const o = await c.query<{ id: string; display_name: string; email: string; locale: string }>(
    `SELECT u.id, u.display_name, u.email, u.locale FROM plans p JOIN users u ON u.id = p.owner_id WHERE p.id = $1`,
    [planId],
  );
  const k = await c.query<{ id: string; display_name: string; email: string; locale: string }>(
    `SELECT u.id, u.display_name, u.email, u.locale FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.plan_id = $1 AND m.role = 'TRUSTED_CONTACT' AND m.revoked_at IS NULL`,
    [planId],
  );
  return { owner: o.rows[0]!, contact: k.rows[0] ?? null };
}

/** Sends reminder n for the check-in due at dueAt, once. Skipped if the owner has checked in since. */
export async function sendReminder(pool: pg.Pool, planId: string, dueAt: number, n: number): Promise<"SENT" | "SKIPPED"> {
  return inTx(pool, async (c) => {
    const s = await c.query<StateRow>(`SELECT * FROM plan_state WHERE plan_id = $1 FOR UPDATE`, [planId]);
    const row = s.rows[0];
    if (!row || row.phase !== "MONITORING" || (row.last_checkin_at && row.last_checkin_at.getTime() >= dueAt)) return "SKIPPED";
    const kind = `CHECKIN_REMINDER_${n}`;
    const due = new Date(dueAt).toISOString();
    const dup = await c.query(
      `SELECT 1 FROM audit_events WHERE plan_id = $1 AND kind = 'CHECKIN_REMINDER_SENT' AND payload->>'dueAt' = $2 AND (payload->>'n')::int = $3`,
      [planId, due, n],
    );
    if (dup.rowCount) return "SKIPPED";
    const { owner } = await people(c, planId);
    const origin = process.env.APP_ORIGIN ?? "http://localhost:3000";
    const [subject, body] = EMAILS[emailLocale(owner.locale)].checkinReminder(origin);
    await outbox(c, planId, owner.id, owner.email, kind, subject, body);
    await appendEvent(c, { planId, at: new Date(), kind: "CHECKIN_REMINDER_SENT", actor: "timeline", payload: { n, dueAt: due } });
    return "SENT";
  });
}

/** Marks the check-in as missed, but only if it really is (INV-20), and asks the contact to look in. */
export async function markMissedIfDue(pool: pg.Pool, planId: string, now = Date.now()): Promise<boolean> {
  return inTx(pool, async (c) => {
    const s = await c.query<StateRow>(`SELECT * FROM plan_state WHERE plan_id = $1`, [planId]);
    const row = s.rows[0];
    if (!row || row.phase !== "MONITORING" || row.checkins_missed || !row.last_checkin_at) return false;
    const plan = await confirmedPlan(c, row.plan_version_id);
    if (!plan) return false;
    const p = policyFor(plan);
    const due = nextDue(row.last_checkin_at.getTime(), p);
    if (!isMissed(due, row.last_checkin_at.getTime(), now, p)) return false;
    const r = await applyEvent(c, planId, { type: "CHECKIN_SEQUENCE_MISSED", at: now }, "timeline", { dueAt: new Date(due).toISOString() });
    if (r.rejected) return false;
    const { owner, contact } = await people(c, planId);
    if (contact) {
      const first = owner.display_name.split(" ")[0] ?? owner.display_name;
      const origin = process.env.APP_ORIGIN ?? "http://localhost:3000";
      const [subject, body] = EMAILS[emailLocale(contact.locale)].contactCheckinMissed(first, origin);
      await outbox(c, planId, contact.id, contact.email, "CONTACT_CHECKIN_MISSED", subject, body, new Date(now));
    }
    return true;
  });
}

/** Ends the waiting period, but only if all of it has passed with no word from the owner (INV-06). */
export async function finishWaitingIfDue(pool: pg.Pool, planId: string, now = Date.now()): Promise<boolean> {
  return inTx(pool, async (c) => {
    const s = await c.query<StateRow>(`SELECT * FROM plan_state WHERE plan_id = $1`, [planId]);
    const row = s.rows[0];
    if (!row || row.phase !== "WAITING" || !row.waiting_started_at) return false;
    if (now - row.waiting_started_at.getTime() < Number(row.waiting_period_ms)) return false;
    const r = await applyEvent(c, planId, { type: "WAITING_PERIOD_CHECK", at: now }, "timeline");
    return !r.rejected && r.state.phase === "ACTIVATED";
  });
}
