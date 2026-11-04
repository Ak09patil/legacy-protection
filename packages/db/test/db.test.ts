/**
 * Runs against a real Postgres (TEST_DATABASE_ADMIN_URL), never a mock:
 * grants and triggers are the guarantee, so they have to be tested for real.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import pg from "pg";
import { appendEventTx as appendEvent, canonicalJson, GENESIS_HASH, migrate, verifyChain } from "../src/index.js";

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL;
const APP_PASSWORD = "lp_app_test_only";
const suite = ADMIN_URL ? describe : describe.skip;
if (!ADMIN_URL) console.warn("TEST_DATABASE_ADMIN_URL not set: skipping database tests");

const dbName = `lp_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
let admin: pg.Client;
let owner: pg.Client; // database owner: runs migrations, plays the "attacker with access"
let app: pg.Client; // the application role

function urlFor(db: string, user?: string): string {
  const u = new URL(ADMIN_URL!);
  u.pathname = `/${db}`;
  if (user) {
    u.username = user;
    u.password = APP_PASSWORD;
  }
  return u.toString();
}

async function newPlan(): Promise<string> {
  const id = randomUUID();
  const ownerId = randomUUID(); // one plan per owner
  await app.query(`INSERT INTO users (id, email, display_name) VALUES ($1, $2, 'Test owner')`, [ownerId, `${ownerId}@example.com`]);
  await app.query(`INSERT INTO plans (id, owner_id) VALUES ($1, $2)`, [id, ownerId]);
  return id;
}

const ev = (planId: string, i: number) => ({
  planId,
  at: new Date(Date.UTC(2026, 10, 2, 12, 0, i)),
  kind: "DECISION",
  actor: "policy",
  payload: { level: i % 2 ? "HOLD" : "PASS", amountMinor: 32000 + i, reasons: [{ code: "R", text: "r" }] },
});

suite("database", () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    owner = new pg.Client({ connectionString: urlFor(dbName) });
    await owner.connect();
    await migrate(owner, APP_PASSWORD);
    app = new pg.Client({ connectionString: urlFor(dbName, "lp_app") });
    await app.connect();
  });

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  it("migrations are idempotent", async () => {
    expect(await migrate(owner)).toEqual([]);
  });

  describe("audit log", () => {
    it("INV-15 a written chain verifies", async () => {
      const plan = await newPlan();
      for (let i = 0; i < 5; i++) await appendEvent(app, ev(plan, i));
      const v = await verifyChain(app, plan);
      expect(v).toMatchObject({ ok: true, length: 5 });
    });

    it("INV-15 app role cannot update or delete", async () => {
      const plan = await newPlan();
      await appendEvent(app, ev(plan, 0));
      await expect(app.query(`UPDATE audit_events SET kind = 'X' WHERE plan_id = $1`, [plan])).rejects.toThrow(
        /permission denied/,
      );
      await expect(app.query(`DELETE FROM audit_events WHERE plan_id = $1`, [plan])).rejects.toThrow(
        /permission denied/,
      );
    });

    it("INV-15 even the table owner is stopped by the append-only trigger", async () => {
      const plan = await newPlan();
      await appendEvent(app, ev(plan, 0));
      await expect(owner.query(`UPDATE audit_events SET kind = 'X' WHERE plan_id = $1`, [plan])).rejects.toThrow(
        /append-only/,
      );
    });

    it("INV-15 tampered row detected", async () => {
      const plan = await newPlan();
      for (let i = 0; i < 6; i++) await appendEvent(app, ev(plan, i));
      // Simulate an attacker with superuser powers editing history.
      await owner.query("BEGIN");
      await owner.query(`ALTER TABLE audit_events DISABLE TRIGGER audit_events_immutable`);
      await owner.query(
        `UPDATE audit_events SET payload = jsonb_set(payload, '{level}', '"PASS"') WHERE plan_id = $1 AND seq = 4`,
        [plan],
      );
      await owner.query(`ALTER TABLE audit_events ENABLE TRIGGER audit_events_immutable`);
      await owner.query("COMMIT");
      expect(await verifyChain(app, plan)).toEqual({
        ok: false,
        brokenAtSeq: 4,
        reason: "content does not match its hash",
      });
    });

    it("INV-15 deleted row detected", async () => {
      const plan = await newPlan();
      for (let i = 0; i < 4; i++) await appendEvent(app, ev(plan, i));
      await owner.query("BEGIN");
      await owner.query(`ALTER TABLE audit_events DISABLE TRIGGER audit_events_immutable`);
      await owner.query(`DELETE FROM audit_events WHERE plan_id = $1 AND seq = 2`, [plan]);
      await owner.query(`ALTER TABLE audit_events ENABLE TRIGGER audit_events_immutable`);
      await owner.query("COMMIT");
      expect(await verifyChain(app, plan)).toMatchObject({ ok: false, brokenAtSeq: 2 });
    });

    it("INV-15 the database rejects an event that doesn't link to the chain", async () => {
      const plan = await newPlan();
      await appendEvent(app, ev(plan, 0));
      await expect(
        app.query(
          `INSERT INTO audit_events (plan_id, seq, at, kind, actor, payload, prev_hash, hash)
           VALUES ($1, 2, now(), 'X', 'mallory', '{}', $2, $2)`,
          [plan, GENESIS_HASH],
        ),
      ).rejects.toThrow(/does not link/);
    });

    it("INV-15 concurrent appends still form one valid chain", async () => {
      const plan = await newPlan();
      const clients = await Promise.all(
        Array.from({ length: 12 }, async () => {
          const c = new pg.Client({ connectionString: urlFor(dbName, "lp_app") });
          await c.connect();
          return c;
        }),
      );
      try {
        // Writers run in parallel; each connection runs its own transactions one at a time,
        // as a connection pool does.
        await Promise.all(
          clients.map(async (c, i) => {
            for (const j of [0, 1, 2]) await appendEvent(c, ev(plan, i * 3 + j));
          }),
        );
      } finally {
        await Promise.all(clients.map((c) => c.end()));
      }
      expect(await verifyChain(app, plan)).toMatchObject({ ok: true, length: 36 });
    });

    it("INV-15 property: arbitrary payloads hash identically after a database round trip", async () => {
      const plan = await newPlan();
      const jsonValue = fc.jsonValue({ maxDepth: 3 }).filter((v) => v !== null && typeof v === "object" && !Array.isArray(v));
      await fc.assert(
        fc.asyncProperty(jsonValue, async (payload) => {
          await appendEvent(app, { ...ev(plan, 0), payload: payload as Record<string, unknown> });
        }),
        { numRuns: 60 },
      );
      expect(await verifyChain(app, plan)).toMatchObject({ ok: true });
    });
  });

  describe("plan versions", () => {
    it("INV-09 confirmed version cannot be updated", async () => {
      const plan = await newPlan();
      const v = randomUUID();
      await app.query(
        `INSERT INTO plan_versions (id, plan_id, version, document, confirmed_at, confirmed_by)
         VALUES ($1, $2, 1, '{"caregiverCapMinor": 32000}', now(), 'owner-1')`,
        [v, plan],
      );
      await expect(app.query(`UPDATE plan_versions SET document = '{}' WHERE id = $1`, [v])).rejects.toThrow(
        /permission denied/,
      );
      await expect(owner.query(`UPDATE plan_versions SET document = '{}' WHERE id = $1`, [v])).rejects.toThrow(
        /append-only/,
      );
    });

    it("INV-09 a new version is added, never overwritten", async () => {
      const plan = await newPlan();
      for (const n of [1, 2]) {
        await app.query(
          `INSERT INTO plan_versions (id, plan_id, version, document, confirmed_at, confirmed_by)
           VALUES ($1, $2, $3, '{}', now(), 'owner-1')`,
          [randomUUID(), plan, n],
        );
      }
      await expect(
        app.query(
          `INSERT INTO plan_versions (id, plan_id, version, document, confirmed_at, confirmed_by)
           VALUES ($1, $2, 2, '{}', now(), 'owner-1')`,
          [randomUUID(), plan],
        ),
      ).rejects.toThrow(/duplicate key/);
    });
  });

  describe("accounts", () => {
    const user = async () => {
      const id = randomUUID();
      await app.query(`INSERT INTO users (id, email, display_name) VALUES ($1, $2, 'Someone')`, [id, `${id}@Example.com`]);
      return id;
    };

    it("INV-22 only token hashes are stored", async () => {
      const cols = await owner.query<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_name IN ('sessions', 'invites', 'users') AND column_name ~ '(token|password|secret)'`,
      );
      for (const c of cols.rows) expect(c.column_name).toBe("token_hash");
      expect(cols.rows.length).toBeGreaterThan(0);
    });

    it("INV-22 email addresses are unique regardless of case", async () => {
      const id = await user();
      await expect(
        app.query(`INSERT INTO users (id, email, display_name) VALUES ($1, $2, 'Copy')`, [randomUUID(), `${id}@EXAMPLE.COM`]),
      ).rejects.toThrow(/duplicate key/);
    });

    it("INV-22 a plan has at most one active trusted contact", async () => {
      const plan = await newPlan();
      const [a, b] = [await user(), await user()];
      await app.query(`INSERT INTO memberships (plan_id, user_id, role) VALUES ($1, $2, 'TRUSTED_CONTACT')`, [plan, a]);
      await expect(
        app.query(`INSERT INTO memberships (plan_id, user_id, role) VALUES ($1, $2, 'TRUSTED_CONTACT')`, [plan, b]),
      ).rejects.toThrow(/duplicate key/);
      await app.query(`UPDATE memberships SET revoked_at = now() WHERE plan_id = $1 AND user_id = $2`, [plan, a]);
      await app.query(`INSERT INTO memberships (plan_id, user_id, role) VALUES ($1, $2, 'TRUSTED_CONTACT')`, [plan, b]);
    });

    it("INV-22 the app role cannot delete people", async () => {
      const id = await user();
      await expect(app.query(`DELETE FROM users WHERE id = $1`, [id])).rejects.toThrow(/permission denied/);
    });
  });

  describe("product state", () => {
    it("INV-06 the database refuses a waiting period under 72 hours", async () => {
      const plan = await newPlan();
      await expect(
        app.query(`INSERT INTO plan_state (plan_id, phase, waiting_period_ms) VALUES ($1, 'MONITORING', $2)`, [plan, 71 * 3_600_000]),
      ).rejects.toThrow(/check constraint/);
    });

    it("INV-16 a recorded decision can never be changed", async () => {
      const plan = await newPlan();
      const pay = randomUUID();
      await app.query(
        `INSERT INTO payments (id, plan_id, payee_name, payee_email, amount_minor, currency, method, status)
         VALUES ($1, $2, 'X', 'x@example.com', 100, 'USD', 'p2p', 'PAUSED')`,
        [pay, plan],
      );
      await app.query(
        `INSERT INTO payment_decisions (payment_id, level, reasons, policy_version, model_status) VALUES ($1, 'HOLD', '[]', 'p', 'OK')`,
        [pay],
      );
      await expect(app.query(`UPDATE payment_decisions SET level = 'PASS' WHERE payment_id = $1`, [pay])).rejects.toThrow();
      await expect(owner.query(`DELETE FROM payment_decisions WHERE payment_id = $1`, [pay])).rejects.toThrow(/append-only/);
    });

    it("INV-03 one PayPal request ID can belong to only one executor step", async () => {
      const plan = await newPlan();
      const ver = randomUUID();
      await app.query(
        `INSERT INTO plan_versions (id, plan_id, version, document, confirmed_at, confirmed_by) VALUES ($1, $2, 1, '{}', now(), 'o')`,
        [ver, plan],
      );
      const ins = (id: string) =>
        app.query(
          `INSERT INTO execution_steps (id, plan_id, plan_version_id, step, label, due_at, status, paypal_request_id)
           VALUES ($1, $2, $3, '{}', 'l', now(), 'SCHEDULED', 'lp-same')`,
          [id, plan, ver],
        );
      await ins("a");
      await expect(ins("b")).rejects.toThrow(/duplicate key/);
    });
  });

  describe("webhooks", () => {
    it("a duplicate webhook event is rejected by the database", async () => {
      await app.query(`INSERT INTO processed_webhook_events (event_id, event_type) VALUES ('WH-1', 'X')`);
      await expect(
        app.query(`INSERT INTO processed_webhook_events (event_id, event_type) VALUES ('WH-1', 'X')`),
      ).rejects.toThrow(/duplicate key/);
    });
  });
});

describe("canonical JSON", () => {
  it("is independent of key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] } })).toBe(
      canonicalJson({ a: { c: [3, { e: 2, f: 1 }], d: 2 }, b: 1 }),
    );
  });

  it("refuses non-finite numbers", () => {
    expect(() => canonicalJson({ x: Number.NaN })).toThrow();
  });
});
