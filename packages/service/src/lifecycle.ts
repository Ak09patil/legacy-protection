/**
 * The one way a plan's state changes, shared by the web app and the Temporal
 * worker. Every change runs in one transaction that locks the plan, runs the
 * pure state machine from @lp/core, writes the new state with an optimistic
 * version bump, appends a hash-chained audit event, and queues notifications
 * in the outbox. The state, the record of why it changed, and the messages
 * about it can never disagree.
 */

import { EMAILS, emailLocale } from "./emails.js";
import { randomUUID } from "node:crypto";
import { initialState, transition, type LifecycleEvent, type LifecycleState, type Phase } from "@lp/core";
import { appendEvent } from "@lp/db/audit";
import type pg from "pg";
import { seal } from "./seal.js";

export type Tx = pg.PoolClient;

export interface StateRow {
  phase: Phase;
  plan_version_id: string | null;
  waiting_period_ms: string;
  checkins_missed: boolean;
  contact_confirmed: boolean;
  waiting_started_at: Date | null;
  last_checkin_at: Date | null;
  version: number;
}

export function toLifecycle(r: StateRow | undefined): LifecycleState {
  if (!r) return initialState;
  return {
    phase: r.phase,
    planVersionId: r.plan_version_id,
    waitingPeriodMs: Number(r.waiting_period_ms),
    checkinsMissed: r.checkins_missed,
    contactConfirmed: r.contact_confirmed,
    waitingStartedAt: r.waiting_started_at?.getTime() ?? null,
  };
}


export type Effects = ReturnType<typeof transition>["effects"];

/**
 * Applies a lifecycle event inside `c`. Returns the rejection reason if the
 * state machine refused it; nothing is written in that case.
 */
export async function applyEvent(
  c: Tx,
  planId: string,
  event: LifecycleEvent,
  actor: string,
  payload: Record<string, unknown> = {},
): Promise<{ rejected: string | null; state: LifecycleState; effects: Effects }> {
  await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 1))`, [planId]);
  const cur = await c.query<StateRow>(`SELECT * FROM plan_state WHERE plan_id = $1 FOR UPDATE`, [planId]);
  if (!cur.rows[0] && event.type !== "PLAN_CONFIRMED") {
    // No confirmed plan yet: there is no lifecycle to move.
    return { rejected: null, state: initialState, effects: [] };
  }
  const before = toLifecycle(cur.rows[0]);
  const t = transition(before, event);
  const rej = t.effects.find((e) => e.type === "REJECTED");
  if (rej && rej.type === "REJECTED") return { rejected: rej.reason, state: before, effects: [] };

  const s = t.state;
  const at = new Date(event.at);
  if (cur.rows[0]) {
    const r = await c.query(
      `UPDATE plan_state SET phase = $2, plan_version_id = $3, waiting_period_ms = $4, checkins_missed = $5,
              contact_confirmed = $6, waiting_started_at = $7, version = version + 1, updated_at = now()
        WHERE plan_id = $1 AND version = $8`,
      [planId, s.phase, s.planVersionId, s.waitingPeriodMs, s.checkinsMissed, s.contactConfirmed, s.waitingStartedAt ? new Date(s.waitingStartedAt) : null, cur.rows[0].version],
    );
    if (r.rowCount !== 1) throw new Error("Plan state changed concurrently");
  } else {
    await c.query(
      `INSERT INTO plan_state (plan_id, phase, plan_version_id, waiting_period_ms, checkins_missed, contact_confirmed, waiting_started_at, last_checkin_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [planId, s.phase, s.planVersionId, s.waitingPeriodMs, s.checkinsMissed, s.contactConfirmed, s.waitingStartedAt ? new Date(s.waitingStartedAt) : null, at],
    );
  }
  await appendEvent(c, { planId, at, kind: event.type, actor, payload: { ...payload, from: before.phase, to: s.phase } });
  await queueEffects(c, planId, t.effects, at);
  return { rejected: null, state: s, effects: t.effects };
}

/** Turns state-machine effects into outbox rows, in the same transaction. */
export async function queueEffects(c: Tx, planId: string, effects: Effects, at: Date) {
  if (effects.length === 0) return;
  const snap = await c.query<{ owner_id: string; owner_name: string; owner_email: string; owner_locale: string }>(
    `SELECT u.id AS owner_id, u.display_name AS owner_name, u.email AS owner_email, u.locale AS owner_locale FROM plans p JOIN users u ON u.id = p.owner_id WHERE p.id = $1`,
    [planId],
  );
  const o = snap.rows[0]!;
  const first = o.owner_name.split(" ")[0] ?? o.owner_name;
  const contact = await c.query<{ id: string; display_name: string; email: string; locale: string }>(
    `SELECT u.id, u.display_name, u.email, u.locale FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.plan_id = $1 AND m.role = 'TRUSTED_CONTACT' AND m.revoked_at IS NULL`,
    [planId],
  );
  const k = contact.rows[0];
  const origin = process.env.APP_ORIGIN ?? "http://localhost:3000";
  for (const e of effects) {
    if (e.type === "NOTIFY_OWNER_ALL_CHANNELS") {
      const m = EMAILS[emailLocale(o.owner_locale)];
      const text = {
        CONTACT_CONFIRMED: m.ownerContactConfirmed(first, k?.display_name ?? null, origin),
        WAITING_STARTED: m.ownerWaitingStarted(origin),
        ACTIVATED: m.ownerActivated(origin),
      }[e.reason];
      await outbox(c, planId, o.owner_id, o.owner_email, `OWNER_${e.reason}`, text[0]!, text[1]!, at);
    } else if (e.type === "NOTIFY_CONTACT" && k) {
      const m = EMAILS[emailLocale(k.locale)];
      const text = {
        ACTIVATION_CANCELLED_BY_OWNER: m.contactOwnerIsOkay(first),
        ACTIVATED: m.contactActivated(first, origin),
      }[e.reason];
      await outbox(c, planId, k.id, k.email, `CONTACT_${e.reason}`, text[0]!, text[1]!, at);
    }
  }
}

/**
 * Queues a message in the outbox. If it carries a secret link, pass it as
 * `secretLink` and write "{{link}}" in the body: the link is stored sealed,
 * and only the delivery worker (which holds APP_SECRET) can fill it in.
 */
export async function outbox(c: Tx, planId: string, recipientId: string | null, to: string, kind: string, subject: string, body: string, at = new Date(), secretLink?: string) {
  await c.query(
    `INSERT INTO notifications (id, plan_id, recipient_id, to_email, kind, subject, body, created_at, secret) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [randomUUID(), planId, recipientId, to, kind, subject, body, at, secretLink ? seal(secretLink) : null],
  );
}

