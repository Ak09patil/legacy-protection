/**
 * The real timeline workflow on Temporal's time-skipping test server, with
 * the real activities on a real Postgres. Weeks of timers pass in seconds;
 * the database decides what happens. Only PayPal is replaced, by a recording
 * executor that behaves like idempotent PayPal calls.
 */
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { bundleWorkflowCode, Worker, type WorkflowBundleWithSourceMap } from "@temporalio/worker";
import pg from "pg";
import { migrate } from "@lp/db";
import { PlanDocumentSchema, type ExecutionStep } from "@lp/policy";
import { applyEvent, inTx, loadTimeline, type Executor } from "@lp/service";
import { createActivities } from "../src/activities.js";
import { changedSignal } from "../src/workflows.js";

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL;
// The worker seals "I'm okay" links into the outbox, so it needs the app secret (as it does in production).
process.env.APP_SECRET ??= "test-app-secret-0123456789-0123456789";
const suite = ADMIN_URL ? describe : describe.skip;
const PW = "lp_app_test_only";
const H = 3_600_000;
const DAY = 24 * H;
const dbName = `lp_wf_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

let env: TestWorkflowEnvironment;
let bundle: WorkflowBundleWithSourceMap;
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

class RecordingExecutor implements Executor {
  readonly name = "recording";
  /** PayPal acts once per request id, however many times it's called. */
  readonly effects = new Map<string, string>();
  attempts = 0;
  failFirst = 0;
  async accountSnapshot() {
    return { activeSubscriptionIds: [], openInvoiceIds: ["INV2-QUILT"] };
  }
  async run(step: ExecutionStep, ctx: { requestId: string }) {
    this.attempts++;
    const key = ctx.requestId || step.id;
    if (!this.effects.has(key)) this.effects.set(key, step.id);
    if (this.attempts <= this.failFirst) throw new Error("connection reset after send");
    return { reference: `ref-${step.id}` };
  }
}

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
      continueForDaysAfterActivation: 14,
    },
  ],
  onActivation: { cancelSubscriptions: true, cancelOpenInvoices: true, holdBalanceForEstate: true },
  contentVisibleTo: [],
});

async function newPlan(at: number) {
  const owner = randomUUID();
  const contact = randomUUID();
  const planId = randomUUID();
  const versionId = randomUUID();
  await pool.query(`INSERT INTO users (id, email, display_name) VALUES ($1, $2, 'Eleanor Hughes'), ($3, $4, 'Priya')`, [owner, `${owner}@example.com`, contact, `${contact}@example.com`]);
  await pool.query(`INSERT INTO plans (id, owner_id) VALUES ($1, $2)`, [planId, owner]);
  await pool.query(`INSERT INTO memberships (plan_id, user_id, role) VALUES ($1, $2, 'OWNER'), ($1, $3, 'TRUSTED_CONTACT')`, [planId, owner, contact]);
  await pool.query(`INSERT INTO plan_versions (id, plan_id, version, document, confirmed_at, confirmed_by) VALUES ($1, $2, 1, $3, $4, $5)`, [versionId, planId, JSON.stringify(plan), new Date(at), owner]);
  await inTx(pool, (c) => applyEvent(c, planId, { type: "PLAN_CONFIRMED", planVersionId: versionId, waitingPeriodMs: 72 * H, at }, owner));
  return { planId, owner, contact };
}

async function waitFor(check: () => Promise<boolean>, skipMs: number, tries = 40) {
  for (let i = 0; i < tries; i++) {
    if (await check()) return;
    await env.sleep(skipMs);
  }
  throw new Error("condition not reached");
}

suite("plan timeline workflow (Temporal time-skipping + Postgres)", () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const o = new pg.Client({ connectionString: url(dbName) });
    await o.connect();
    await migrate(o, PW);
    await o.end();
    pool = new pg.Pool({ connectionString: url(dbName, "lp_app"), max: 6 });
    pool.on("error", () => undefined);
    env = await TestWorkflowEnvironment.createTimeSkipping();
    bundle = await bundleWorkflowCode({
      workflowsPath: fileURLToPath(new URL("../src/workflows.ts", import.meta.url)),
      logger: { log: () => {}, trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });
  }, 180_000);

  afterAll(async () => {
    await env?.teardown();
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  const run = async <T>(executor: Executor, fn: (taskQueue: string) => Promise<T>) => {
    const taskQueue = `tq-${randomUUID()}`;
    const worker = await Worker.create({ connection: env.nativeConnection, taskQueue, workflowBundle: bundle, activities: createActivities(pool, executor) });
    return worker.runUntil(fn(taskQueue));
  };

  it("INV-06 INV-20 a missed check-in, a confirmation and the full wait activate the plan; then it pays Maria once per week", async () => {
    const start = (await env.currentTimeMs()) as unknown as number;
    const { planId, contact } = await newPlan(Number(start));
    const ex = new RecordingExecutor();
    ex.failFirst = 1; // the first PayPal call fails after sending; the retry must not pay twice

    await run(ex, async (taskQueue) => {
      const h = await env.client.workflow.start("planTimeline", { taskQueue, workflowId: `plan-${planId}`, args: [{ planId }] });
      // Ten days pass with no check-in: reminders, then the check-in counts as missed.
      await waitFor(async () => (await loadTimeline(pool, planId))?.checkinsMissed === true, DAY);
      // Priya confirms; the app signals the timeline.
      const confirmAt = Number(await env.currentTimeMs());
      await inTx(pool, (c) => applyEvent(c, planId, { type: "CONTACT_CONFIRMED", passkeyVerified: true, at: confirmAt }, contact));
      await h.signal(changedSignal);
      await waitFor(async () => (await loadTimeline(pool, planId))?.phase === "COMPLETED", DAY, 60);
      return h.result();
    });

    const kinds = (await pool.query<{ kind: string }>(`SELECT kind FROM audit_events WHERE plan_id = $1 ORDER BY seq`, [planId])).rows.map((r) => r.kind);
    expect(kinds).toEqual(expect.arrayContaining(["CHECKIN_REMINDER_SENT", "CHECKIN_SEQUENCE_MISSED", "CONTACT_CONFIRMED", "WAITING_PERIOD_CHECK", "EXECUTION_STARTED", "STEP_DONE", "EXECUTION_COMPLETED"]));
    expect(kinds.filter((k) => k === "CHECKIN_REMINDER_SENT")).toHaveLength(2);
    const paid = [...ex.effects.values()].filter((id) => id.startsWith("pay:"));
    expect(paid).toEqual(["pay:maria-care:0", "pay:maria-care:1"]); // two weeks, each once, despite the retry
  }, 120_000);

  it("INV-07 the owner checking in during the wait stops everything", async () => {
    const start = Number(await env.currentTimeMs());
    const { planId, owner, contact } = await newPlan(start);
    const ex = new RecordingExecutor();
    await run(ex, async (taskQueue) => {
      const h = await env.client.workflow.start("planTimeline", { taskQueue, workflowId: `plan-${planId}`, args: [{ planId }] });
      await waitFor(async () => (await loadTimeline(pool, planId))?.checkinsMissed === true, DAY);
      const confirmAt = Number(await env.currentTimeMs());
      await inTx(pool, (c) => applyEvent(c, planId, { type: "CONTACT_CONFIRMED", passkeyVerified: true, at: confirmAt }, contact));
      await h.signal(changedSignal);
      await env.sleep(2 * DAY);
      expect((await loadTimeline(pool, planId))?.phase).toBe("WAITING");
      const now = Number(await env.currentTimeMs());
      await inTx(pool, async (c) => {
        await c.query(`UPDATE plan_state SET last_checkin_at = $2 WHERE plan_id = $1`, [planId, new Date(now)]);
        await applyEvent(c, planId, { type: "OWNER_ACTIVITY", at: now }, owner);
      });
      await h.signal(changedSignal);
      await env.sleep(5 * DAY);
      expect((await loadTimeline(pool, planId))?.phase).toBe("MONITORING");
      await h.terminate("test done");
    });
    expect(ex.effects.size).toBe(0); // nothing ran
  }, 120_000);
});
