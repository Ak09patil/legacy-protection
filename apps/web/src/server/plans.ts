import "server-only";

/**
 * The plan service: the only code that changes a plan's state.
 *
 * Every change runs in one transaction that
 *   1. locks the plan's state row,
 *   2. runs the event through the pure state machine in @lp/core,
 *   3. writes the new state with an optimistic version bump,
 *   4. appends a hash-chained audit event, and
 *   5. queues any notifications in the outbox.
 * So the state, the record of why it changed, and the messages about it can
 * never disagree.
 */

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { DEFAULT_POLICY, nextDue, type LifecycleState, type Phase } from "@lp/core";
import { appendEvent, verifyChain } from "@lp/db/audit";
import { applyEvent, outbox, toLifecycle, type StateRow } from "@lp/service";
export { applyEvent, outbox };
import { PlanDocumentSchema, summarisePlan, type PlanDocument } from "@lp/policy";
import { createInvite, currentUser, type Role, type SessionUser } from "./auth";
import { db, tx } from "./db";

const HOUR = 3_600_000;

// ---------------------------------------------------------------------------
// Who is asking
// ---------------------------------------------------------------------------

export interface Ctx {
  user: SessionUser;
  planId: string;
  role: Role;
  ownerName: string;
}

/** Requires a signed-in person with one of `roles` on some plan. Redirects otherwise. */
export async function requireRole(...roles: Role[]): Promise<Ctx> {
  const user = await currentUser();
  if (!user) redirect("/signin");
  const m = user.memberships.find((x) => roles.includes(x.role));
  if (!m) redirect(landingFor(user));
  return { user, planId: m.planId, role: m.role, ownerName: m.ownerName };
}

export function landingFor(user: SessionUser): string {
  const roles = user.memberships.map((m) => m.role);
  if (roles.includes("OWNER")) return "/home";
  if (roles.includes("TRUSTED_CONTACT")) return "/contact";
  if (roles.includes("EXECUTOR")) return "/executor";
  return "/signin";
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface PlanSnapshot {
  planId: string;
  owner: { id: string; name: string; firstName: string; email: string };
  state: LifecycleState;
  stateVersion: number;
  lastCheckinAt: number | null;
  confirmed: { id: string; version: number; document: PlanDocument; confirmedAt: number; summary: string[] } | null;
  draft: PlanDocument | null;
  contact: { name: string; email: string; status: "NONE" | "INVITED" | "JOINED" };
  executor: { name: string; email: string; status: "NONE" | "INVITED" | "JOINED" };
  nextCheckinAt: number | null;
}

export async function snapshot(planId: string): Promise<PlanSnapshot> {
  const q = db();
  const [owner, state, ver, draft, members, invites] = await Promise.all([
    q.query<{ id: string; display_name: string; email: string }>(
      `SELECT u.id, u.display_name, u.email FROM plans p JOIN users u ON u.id = p.owner_id WHERE p.id = $1`,
      [planId],
    ),
    q.query<StateRow>(`SELECT * FROM plan_state WHERE plan_id = $1`, [planId]),
    q.query<{ id: string; version: number; document: unknown; confirmed_at: Date }>(
      `SELECT id, version, document, confirmed_at FROM plan_versions WHERE plan_id = $1 ORDER BY version DESC LIMIT 1`,
      [planId],
    ),
    q.query<{ document: unknown }>(`SELECT document FROM plan_drafts WHERE plan_id = $1`, [planId]),
    q.query<{ role: Role; display_name: string; email: string }>(
      `SELECT m.role, u.display_name, u.email FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.plan_id = $1 AND m.revoked_at IS NULL AND m.role <> 'OWNER'`,
      [planId],
    ),
    q.query<{ role: Role; name: string; email: string }>(
      `SELECT role, name, email FROM invites WHERE plan_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
      [planId],
    ),
  ]);
  const o = owner.rows[0];
  if (!o) throw new Error("Plan not found");
  const s = state.rows[0];
  const v = ver.rows[0];
  const confirmedDoc = v ? PlanDocumentSchema.parse(v.document) : null;
  const person = (role: Role) => {
    const m = members.rows.find((x) => x.role === role);
    if (m) return { name: m.display_name, email: m.email, status: "JOINED" as const };
    const i = invites.rows.find((x) => x.role === role);
    if (i) return { name: i.name, email: i.email, status: "INVITED" as const };
    return { name: "", email: "", status: "NONE" as const };
  };
  const lastCheckinAt = s?.last_checkin_at?.getTime() ?? null;
  return {
    planId,
    owner: { id: o.id, name: o.display_name, firstName: o.display_name.split(" ")[0] ?? o.display_name, email: o.email },
    state: toLifecycle(s),
    stateVersion: s?.version ?? 0,
    lastCheckinAt,
    confirmed:
      v && confirmedDoc
        ? { id: v.id, version: v.version, document: confirmedDoc, confirmedAt: v.confirmed_at.getTime(), summary: summarisePlan(confirmedDoc) }
        : null,
    draft: draft.rows[0] ? (draft.rows[0].document as PlanDocument) : null,
    contact: person("TRUSTED_CONTACT"),
    executor: person("EXECUTOR"),
    nextCheckinAt:
      confirmedDoc && lastCheckinAt !== null ? nextDue(lastCheckinAt, { ...DEFAULT_POLICY, ...confirmedDoc.checkin }) : null,
  };
}

// ---------------------------------------------------------------------------
// The one way state changes
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Owner actions
// ---------------------------------------------------------------------------

/** "I'm here." Any sign of the owner cancels progress toward activation (INV-07). */
export async function checkIn(ctx: Ctx, channel: "app" | "email_link" = "app"): Promise<void> {
  if (ctx.role !== "OWNER") throw new Error("Only the owner can check in");
  await tx(async (c) => {
    const now = new Date();
    await c.query(`INSERT INTO checkins (plan_id, user_id, at, channel) VALUES ($1, $2, $3, $4)`, [ctx.planId, ctx.user.id, now, channel]);
    const has = await c.query(`SELECT 1 FROM plan_state WHERE plan_id = $1`, [ctx.planId]);
    if (!has.rowCount) return; // no confirmed plan yet: nothing to cancel
    await c.query(`UPDATE plan_state SET last_checkin_at = $2 WHERE plan_id = $1`, [ctx.planId, now]);
    await applyEvent(c, ctx.planId, { type: "OWNER_ACTIVITY", at: now.getTime() }, ctx.user.id, { channel });
  });
}

export async function saveDraft(ctx: Ctx, doc: unknown): Promise<void> {
  if (ctx.role !== "OWNER") throw new Error("Only the owner can edit the plan");
  await db().query(
    `INSERT INTO plan_drafts (plan_id, document, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (plan_id) DO UPDATE SET document = EXCLUDED.document, updated_at = now()`,
    [ctx.planId, JSON.stringify(doc)],
  );
}

export type ConfirmResult = { ok: true; version: number; inviteLinks: string[] } | { ok: false; issues: string[] };

/**
 * Confirms a new immutable plan version (INV-09). Also invites the trusted
 * contact if they changed, so the person named in the plan is the person
 * who can act.
 */
export async function confirmPlan(ctx: Ctx, candidate: unknown): Promise<ConfirmResult> {
  if (ctx.role !== "OWNER") return { ok: false, issues: ["Only the owner can confirm the plan."] };
  const parsed = PlanDocumentSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((i) => i.message) };
  const doc = parsed.data;
  if (doc.trustedContact.email === ctx.user.email.toLowerCase()) {
    return { ok: false, issues: ["Your trusted contact needs to be someone other than you."] };
  }

  return tx(async (c) => {
    const now = Date.now();
    const has = await c.query<{ phase: Phase }>(`SELECT phase FROM plan_state WHERE plan_id = $1 FOR UPDATE`, [ctx.planId]);
    const phase = has.rows[0]?.phase;
    if (phase && phase !== "MONITORING" && phase !== "WAITING" && phase !== "DRAFT") {
      return { ok: false as const, issues: ["This plan has already started, so it can no longer be changed."] };
    }
    if (phase) await applyEvent(c, ctx.planId, { type: "OWNER_ACTIVITY", at: now }, ctx.user.id, { channel: "plan_edit" });

    const next = await c.query<{ v: number }>(`SELECT COALESCE(MAX(version), 0) + 1 AS v FROM plan_versions WHERE plan_id = $1`, [ctx.planId]);
    const version = next.rows[0]!.v;
    const versionId = randomUUID();
    await c.query(
      `INSERT INTO plan_versions (id, plan_id, version, document, confirmed_at, confirmed_by) VALUES ($1, $2, $3, $4, $5, $6)`,
      [versionId, ctx.planId, version, JSON.stringify(doc), new Date(now), ctx.user.id],
    );
    const r = await applyEvent(
      c,
      ctx.planId,
      { type: "PLAN_CONFIRMED", planVersionId: versionId, waitingPeriodMs: doc.waitingPeriodHours * HOUR, at: now },
      ctx.user.id,
      { version },
    );
    if (r.rejected) throw new Error(r.rejected);
    await c.query(`DELETE FROM plan_drafts WHERE plan_id = $1`, [ctx.planId]);

    // Invite the named contact unless they're already the active one.
    const links: string[] = [];
    const active = await c.query<{ email: string }>(
      `SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.plan_id = $1 AND m.role = 'TRUSTED_CONTACT' AND m.revoked_at IS NULL`,
      [ctx.planId],
    );
    if (active.rows[0]?.email.toLowerCase() !== doc.trustedContact.email) {
      const link = await createInvite(c, ctx.planId, ctx.user.id, "TRUSTED_CONTACT", doc.trustedContact.name, doc.trustedContact.email);
      links.push(link);
      await outbox(
        c,
        ctx.planId,
        null,
        doc.trustedContact.email,
        "INVITE_TRUSTED_CONTACT",
        `${ctx.user.name} has asked you to be their trusted contact`,
        `${ctx.user.name} uses Legacy Protection on their PayPal account and would like you to be their trusted contact. You’ll never be able to move or receive their money.\n\nAccept within 7 days: {{link}}`,
        new Date(now),
        link,
      );
    }
    return { ok: true as const, version, inviteLinks: links };
  });
}

export async function inviteExecutor(ctx: Ctx, name: string, email: string): Promise<{ ok: true; link: string } | { ok: false; message: string }> {
  if (ctx.role !== "OWNER") return { ok: false, message: "Only the owner can invite an executor." };
  const n = name.trim().slice(0, 80);
  const e = email.trim().toLowerCase();
  if (!n || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { ok: false, message: "Please enter a name and a valid email." };
  const link = await tx(async (c) => {
    const l = await createInvite(c, ctx.planId, ctx.user.id, "EXECUTOR", n, e);
    await outbox(c, ctx.planId, null, e, "INVITE_EXECUTOR", `${ctx.user.name} has named you as their executor`, `Accept within 7 days: {{link}}`, new Date(), l);
    await appendEvent(c, { planId: ctx.planId, at: new Date(), kind: "EXECUTOR_INVITED", actor: ctx.user.id, payload: {} });
    return l;
  });
  return { ok: true, link };
}

export async function auditFor(planId: string) {
  const [rows, verdict] = await Promise.all([
    db().query<{ seq: number; at: Date; kind: string; actor: string; payload: Record<string, unknown>; hash: string }>(
      `SELECT seq, at, kind, actor, payload, hash FROM audit_events WHERE plan_id = $1 ORDER BY seq DESC LIMIT 200`,
      [planId],
    ),
    verifyChain(db(), planId),
  ]);
  return { entries: rows.rows, verdict };
}

/** Issues a fresh invite link (revoking the old one) so the owner can send it themselves. */
export async function reissueInvite(ctx: Ctx, role: "TRUSTED_CONTACT" | "EXECUTOR"): Promise<{ ok: true; link: string } | { ok: false; message: string }> {
  if (ctx.role !== "OWNER") return { ok: false, message: "Only the owner can invite people." };
  return tx(async (c) => {
    const r = await c.query<{ name: string; email: string }>(
      `SELECT name, email FROM invites WHERE plan_id = $1 AND role = $2 AND accepted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
      [ctx.planId, role],
    );
    const inv = r.rows[0];
    if (!inv) return { ok: false as const, message: "There’s no pending invitation to resend." };
    const link = await createInvite(c, ctx.planId, ctx.user.id, role, inv.name, inv.email);
    return { ok: true as const, link };
  });
}
