import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { decodeField, encodeField, httpVault, isSealedField, KeyStore, localVault, masterKeyFrom, POLICY, signRequest, VaultRefused } from "../src/index.js";
import { migrateVault } from "../src/migrate.js";
import { createVaultServer } from "../src/server.js";

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL;
const suite = ADMIN_URL ? describe : describe.skip;
const dbName = `lp_vault_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const MASTER = masterKeyFrom("test-master-key-that-is-long-enough-0123456789");
let admin: pg.Client;
let pool: pg.Pool;
let store: KeyStore;

suite("vault", () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const u = new URL(ADMIN_URL!);
    u.pathname = `/${dbName}`;
    pool = new pg.Pool({ connectionString: u.toString(), max: 4 });
    pool.on("error", () => undefined);
    const c = await pool.connect();
    await migrateVault(c);
    c.release();
    store = new KeyStore(pool, MASTER);
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  it("INV-24 the main database only ever holds ciphertext, bound to its plan and kind", async () => {
    const web = localVault(store, "web");
    const plan = randomUUID();
    const sealed = await web.sealField(plan, "payment_note", "Buy gift cards today to unlock your account", "owner_view");
    expect(isSealedField(sealed)).toBe(true);
    expect(sealed).not.toMatch(/gift/i);
    expect(await web.openField(plan, "payment_note", sealed, "owner_view")).toBe("Buy gift cards today to unlock your account");
    // Copied onto another plan, or read as another kind, it won't open.
    await expect(web.openField(randomUUID(), "payment_note", sealed, "owner_view")).rejects.toThrow();
    await expect(web.openField(plan, "plan_document", sealed, "owner_view")).rejects.toThrow();
  });

  it("INV-24 the worker can never read what scammers wrote to the owner", async () => {
    const web = localVault(store, "web");
    const worker = localVault(store, "worker");
    const plan = randomUUID();
    const note = await web.sealField(plan, "payment_note", "secret message", "owner_view");
    await expect(worker.openField(plan, "payment_note", note, "run_plan")).rejects.toBeInstanceOf(VaultRefused);
    const doc = await web.sealField(plan, "plan_document", '{"carer":"Maria"}', "confirm");
    expect(await worker.openField(plan, "plan_document", doc, "run_plan")).toBe('{"carer":"Maria"}');
  });

  it("INV-24 every release, allowed or refused, is logged, and the log can't be edited", async () => {
    const web = localVault(store, "web");
    const plan = randomUUID();
    const v = await web.sealField(plan, "payment_note", "x", "owner_view");
    await web.openField(plan, "payment_note", v, "ai_helper");
    await expect(web.openField(plan, "payment_note", v, "marketing")).rejects.toThrow();
    const log = await pool.query(`SELECT purpose, allowed FROM access_log WHERE key_id = $1 OR (key_id IS NULL AND purpose = 'marketing') ORDER BY id`, [decodeField(v).keyId]);
    expect(log.rows).toEqual(
      expect.arrayContaining([
        { purpose: "owner_view", allowed: true },
        { purpose: "ai_helper", allowed: true },
        { purpose: "marketing", allowed: false },
      ]),
    );
    await expect(pool.query(`DELETE FROM access_log`)).rejects.toThrow(/append-only/);
    await expect(pool.query(`UPDATE data_keys SET kind = 'plan_document'`)).rejects.toThrow(/append-only/);
  });

  it("INV-24 the vault's database holds no usable keys without the master key", async () => {
    const plan = randomUUID();
    const v = await localVault(store, "web").sealField(plan, "payment_note", "x", "owner_view");
    const other = new KeyStore(pool, masterKeyFrom("a-different-master-key-also-long-enough-00000"));
    await expect(other.keyForRead("web", decodeField(v).keyId, "payment_note", "owner_view")).rejects.toThrow();
  });

  it("INV-24 a tampered ciphertext is detected", async () => {
    const plan = randomUUID();
    const web = localVault(store, "web");
    const v = await web.sealField(plan, "payment_note", "hello", "owner_view");
    const { keyId, sealed } = decodeField(v);
    sealed[sealed.length - 1] ^= 1;
    await expect(web.openField(plan, "payment_note", encodeField(keyId, sealed), "owner_view")).rejects.toThrow();
  });

  it("the policy table never lets the worker read payment notes", () => {
    expect(POLICY.payment_note.worker).toEqual([]);
  });

  describe("over HTTP", () => {
    let base = "";
    let server: ReturnType<typeof createVaultServer>;
    beforeAll(async () => {
      server = createVaultServer(store, { web: "web-secret-0123456789", worker: "worker-secret-0123456789" });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => new Promise<void>((r) => server.close(() => r())));

    it("INV-24 a signed client works end to end", async () => {
      const web = httpVault(base, "web", "web-secret-0123456789");
      const plan = randomUUID();
      const v = await web.sealField(plan, "plan_document", "doc", "confirm");
      expect(await httpVault(base, "worker", "worker-secret-0123456789").openField(plan, "plan_document", v, "run_plan")).toBe("doc");
    });

    it("INV-24 a wrong secret, another client's secret, or an old replayed request is refused", async () => {
      const plan = randomUUID();
      await expect(httpVault(base, "web", "wrong").sealField(plan, "plan_document", "x", "confirm")).rejects.toThrow(/unauthorized/);
      await expect(httpVault(base, "worker", "web-secret-0123456789").sealField(plan, "plan_document", "x", "confirm")).rejects.toThrow(/unauthorized/);
      const body = JSON.stringify({ ownerRef: plan, kind: "plan_document", purpose: "confirm" });
      const old = String(Date.now() - 5 * 60_000);
      const res = await fetch(`${base}/v1/keys/write`, {
        method: "POST",
        headers: { "x-vault-client": "web", "x-vault-timestamp": old, "x-vault-signature": signRequest("web-secret-0123456789", "POST", "/v1/keys/write", old, body) },
        body,
      });
      expect(res.status).toBe(401);
    });
  });
});
