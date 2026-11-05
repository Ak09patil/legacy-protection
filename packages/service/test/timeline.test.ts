/**
 * The whole "Eleanor can't act" path against a real Postgres: missed
 * check-in, contact confirmation, the waiting period, activation, and every
 * step run through the gate. Timers are simulated by passing `now`; the
 * Temporal workflow that calls these in production is tested separately.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { migrate } from "@lp/db";
import { PlanDocumentSchema, type ExecutionStep } from "@lp/policy";
import { KeyStore, localVault, masterKeyFrom, unsealedDevVault } from "@lp/vault";
import { migrateVault } from "../../vault/src/migrate.js";
import { applyEvent, completeIfAllDone, configureVault, DryRunExecutor, finishWaitingIfDue, inTx, loadTimeline, markMissedIfDue, pendingSteps, runStep, sendReminder, startExecution, type Executor } from "../src/index.js";

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL;
// The worker seals "I'm okay" links into the outbox, so it needs the app secret (as it does in production).
process.env.APP_SECRET ??= "test-app-secret-0123456789-0123456789";
const suite = ADMIN_URL ? describe : describe.skip;
const PW = "lp_app_test_only";
const DAY = 86_400_000;
const HOUR = 3_600_000;
const dbName = `lp_svc_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
let admin: pg.Client;
let pool: pg.Pool;

const url = (db: string, user?: string) => {
  const u = new URL(ADMIN_URL!);
  u.pathname = `/${db}`;
  if (user) {
    u.username = user;
    u.password = PW;
  }
  return u.toString();
};

const plan = PlanDocumentSchema.parse({
  schemaVersion: 1,
  trustedContact: { name: "Priya", email: "priya@example.com" },
  checkin: { timeZone: "America/New_York", intervalDays: 7, localHour: 10, localMinute: 0 },
  waitingPeriodHours: 72,
  obligations: [
    {
      id: "maria-care",
      kind: "HOUSEHOLD_EMPLOYEE",
      payeeName: "Maria",
      payeeEmail: "maria@example.com",
      description: "home care",
      amountPerPaymentMinor: 32000,
      maxPerMonthMinor: 140000,
      currency: "USD",
      cadence: "WEEKLY",
      continueForDaysAfterActivation: 21,
    },
  ],
  onActivation: { cancelSubscriptions: true, cancelOpenInvoices: true, holdBalanceForEstate: true },
  contentVisibleTo: [],
});

/** Records what ran, and can be told to fail once to prove retries are safe. */
class RecordingExecutor implements Executor {
  readonly name = "recording";
  readonly ran: Array<{ id: string; requestId: string }> = [];
  failNext = false;
  async accountSnapshot() {
    return { activeSubscriptionIds: [], openInvoiceIds: ["INV2-QUILT"] };
  }
  async run(step: ExecutionStep, ctx: { requestId: string }) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("PayPal temporarily unavailable");
    }
    this.ran.push({ id: step.id, requestId: ctx.requestId });
    return { reference: `ref-${step.id}` };
  }
}

async function newPlan(confirmedAt: number) {
  const owner = randomUUID();
  const contact = randomUUID();
  const planId = randomUUID();
  const versionId = randomUUID();
  await pool.query(`INSERT INTO users (id, email, display_name) VALUES ($1, $2, 'Eleanor Hughes'), ($3, $4, 'Priya')`, [owner, `${owner}@example.com`, contact, `${contact}@example.com`]);
  await pool.query(`INSERT INTO plans (id, owner_id) VALUES ($1, $2)`, [planId, owner]);
  await pool.query(`INSERT INTO memberships (plan_id, user_id, role) VALUES ($1, $2, 'OWNER'), ($1, $3, 'TRUSTED_CONTACT')`, [planId, owner, contact]);
  await pool.query(`INSERT INTO plan_versions (id, plan_id, version, document, confirmed_at, confirmed_by) VALUES ($1, $2, 1, $3, $4, $5)`, [versionId, planId, JSON.stringify(plan), new Date(confirmedAt), owner]);
  await inTx(pool, (c) => applyEvent(c, planId, { type: "PLAN_CONFIRMED", planVersionId: versionId, waitingPeriodMs: 72 * HOUR, at: confirmedAt }, owner));
  return { planId, owner, contact };
}

suite("plan timeline on Postgres", () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const owner = new pg.Client({ connectionString: url(dbName) });
    await owner.connect();
    await migrate(owner, PW);
    await owner.end();
    pool = new pg.Pool({ connectionString: url(dbName, "lp_app"), max: 4 });
    pool.on("error", () => undefined); // idle clients are terminated when the test database is dropped
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  it("INV-20 a check-in isn't missed until the whole window, reminders included, has passed", async () => {
    const t0 = Date.UTC(2026, 10, 2, 15);
    const { planId } = await newPlan(t0);
    const tl = await loadTimeline(pool, planId);
    expect(tl?.phase).toBe("MONITORING");
    const w = tl!.window!;
    expect(w.reminders).toHaveLength(2);
    expect(await markMissedIfDue(pool, planId, w.missedAt - 1)).toBe(false);
    expect(await sendReminder(pool, planId, w.dueAt, 1)).toBe("SENT");
    expect(await sendReminder(pool, planId, w.dueAt, 1)).toBe("SKIPPED"); // never twice
    expect(await markMissedIfDue(pool, planId, w.missedAt + 1)).toBe(true);
    expect(await markMissedIfDue(pool, planId, w.missedAt + 2)).toBe(false); // replayed timer does nothing
    const n = await pool.query(`SELECT kind FROM notifications WHERE plan_id = $1 ORDER BY created_at`, [planId]);
    expect(n.rows.map((r) => r.kind)).toEqual(["CHECKIN_REMINDER_1", "CONTACT_CHECKIN_MISSED"]);
  });

  it("INV-06 nothing activates before the full waiting period, and INV-07 the owner can stop it", async () => {
    const t0 = Date.UTC(2026, 10, 2, 15);
    const { planId, owner, contact } = await newPlan(t0);
    const w = (await loadTimeline(pool, planId))!.window!;
    await markMissedIfDue(pool, planId, w.missedAt + 1);
    const confirmAt = w.missedAt + HOUR;
    await inTx(pool, (c) => applyEvent(c, planId, { type: "CONTACT_CONFIRMED", passkeyVerified: true, at: confirmAt }, contact));
    expect((await loadTimeline(pool, planId))!.phase).toBe("WAITING");
    expect(await finishWaitingIfDue(pool, planId, confirmAt + 72 * HOUR - 1)).toBe(false);
    // Owner checks in during the wait: everything resets.
    await inTx(pool, (c) => applyEvent(c, planId, { type: "OWNER_ACTIVITY", at: confirmAt + 10 * HOUR }, owner));
    expect((await loadTimeline(pool, planId))!.phase).toBe("MONITORING");
    expect(await finishWaitingIfDue(pool, planId, confirmAt + 80 * HOUR)).toBe(false);
  });

  it("INV-02 INV-03 an activated plan runs only its own steps, each once, through the gate", async () => {
    const t0 = Date.UTC(2026, 10, 2, 15);
    const { planId, contact } = await newPlan(t0);
    const w = (await loadTimeline(pool, planId))!.window!;
    await markMissedIfDue(pool, planId, w.missedAt + 1);
    const confirmAt = w.missedAt + HOUR;
    await inTx(pool, (c) => applyEvent(c, planId, { type: "CONTACT_CONFIRMED", passkeyVerified: true, at: confirmAt }, contact));
    const activateAt = confirmAt + 72 * HOUR + 1;
    expect(await finishWaitingIfDue(pool, planId, activateAt)).toBe(true);

    const ex = new RecordingExecutor();
    expect(await startExecution(pool, planId, ex, activateAt)).toBe(true);
    expect(await startExecution(pool, planId, ex, activateAt)).toBe(true); // idempotent
    const pending = await pendingSteps(pool, planId);
    expect(pending.map((p) => p.id)).toEqual(expect.arrayContaining(["cancel-inv:INV2-QUILT", "pay:maria-care:0", "executor-package"]));

    // A failure is retried safely with the same request id.
    ex.failNext = true;
    await expect(runStep(pool, planId, "pay:maria-care:0", ex, activateAt)).rejects.toThrow();
    expect(await runStep(pool, planId, "pay:maria-care:0", ex, activateAt)).toEqual({ outcome: "DONE" });
    expect(await runStep(pool, planId, "pay:maria-care:0", ex, activateAt)).toEqual({ outcome: "SKIPPED" });
    expect(ex.ran.filter((r) => r.id === "pay:maria-care:0")).toHaveLength(1);

    // Next week's payment is refused by the gate until it's due.
    expect(await runStep(pool, planId, "pay:maria-care:1", ex, activateAt)).toEqual({ outcome: "REFUSED", detail: "NOT_DUE" });
    expect(await runStep(pool, planId, "pay:maria-care:1", ex, activateAt + 7 * DAY)).toEqual({ outcome: "DONE" });

    for (const p of await pendingSteps(pool, planId)) await runStep(pool, planId, p.id, ex, Math.max(p.dueAt, activateAt));
    expect(await completeIfAllDone(pool, planId, activateAt + 30 * DAY)).toBe(true);
    expect((await loadTimeline(pool, planId))!.phase).toBe("COMPLETED");
    // Three weekly payments within 21 days; the cap allows all of them.
    expect(ex.ran.filter((r) => r.id.startsWith("pay:")).map((r) => r.id)).toEqual(["pay:maria-care:0", "pay:maria-care:1", "pay:maria-care:2"]);
    const ids = ex.ran.map((r) => r.requestId).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length); // every money step has its own request id
  });

  it("INV-24 with a vault configured, executor steps are stored sealed and name no one", async () => {
    const vaultDb = `${dbName}_v`;
    await admin.query(`CREATE DATABASE ${vaultDb}`);
    const vp = new pg.Pool({ connectionString: url(vaultDb), max: 2 });
    vp.on("error", () => undefined);
    try {
      const c = await vp.connect();
      await migrateVault(c);
      c.release();
      configureVault(localVault(new KeyStore(vp, masterKeyFrom("x".repeat(40))), "worker"));
      const t0 = Date.UTC(2026, 10, 2, 15);
      const { planId, contact } = await newPlan(t0);
      const w = (await loadTimeline(pool, planId))!.window!;
      await markMissedIfDue(pool, planId, w.missedAt + 1);
      await inTx(pool, (c2) => applyEvent(c2, planId, { type: "CONTACT_CONFIRMED", passkeyVerified: true, at: w.missedAt + HOUR }, contact));
      const at = w.missedAt + HOUR + 72 * HOUR + 1;
      await finishWaitingIfDue(pool, planId, at);
      const ex = new RecordingExecutor();
      await startExecution(pool, planId, ex, at);
      const raw = await pool.query<{ step: unknown; label: string }>(`SELECT step, label FROM execution_steps WHERE plan_id = $1`, [planId]);
      expect(raw.rows.length).toBeGreaterThan(0);
      for (const r of raw.rows) {
        expect(JSON.stringify(r)).not.toMatch(/maria|@example\.com/i);
        expect((r.step as { sealed?: string }).sealed).toMatch(/^lpv1\./);
      }
      expect(await runStep(pool, planId, "pay:maria-care:0", ex, at)).toEqual({ outcome: "DONE" });
    } finally {
      configureVault(unsealedDevVault());
      await vp.end();
      await admin.query(`DROP DATABASE IF EXISTS ${vaultDb} WITH (FORCE)`);
    }
  });

  it("dry run records steps without pretending to send anything", async () => {
    const ex = new DryRunExecutor();
    expect((await ex.run({ id: "pay:x:0", type: "PAY_OBLIGATION", obligationId: "x", payeeEmail: "a@b.c", amountMinor: 1, currency: "USD", dueAt: 0 })).reference).toBe("dry-run:pay:x:0");
  });
});
