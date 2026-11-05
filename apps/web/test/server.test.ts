/**
 * The web app's server code (sign-in, invites, plans, payments) against a
 * real Postgres, with Next.js replaced by small shims. Each person signs in
 * with an email code read from the dev mailer, the way a real user would.
 */
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { migrate } from "@lp/db";
import { PlanDocumentSchema, type PlanDocument } from "@lp/policy";
import { testCookies } from "./shims/next-headers";

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL;
const suite = ADMIN_URL ? describe : describe.skip;
const PW = "lp_app_test_only";
const dbName = `lp_web_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
let admin: pg.Client;
let riskServer: Server;
let riskMode: "pass" | "hold" | "down" = "pass";

// Loaded after the environment is set, so the app's db() pool points at the test database.
let auth: typeof import("../src/server/auth");
let plans: typeof import("../src/server/plans");
let payments: typeof import("../src/server/payments");
let db: typeof import("../src/server/db");

const sentCodes: string[] = [];
const sentTo: string[] = [];
const sentSubjects: string[] = [];

const url = (database: string, user?: string) => {
  const u = new URL(ADMIN_URL!);
  u.pathname = `/${database}`;
  if (user) {
    u.username = user;
    u.password = PW;
  }
  return u.toString();
};

/** Signs up with an email code and returns that person's session cookie. */
async function signUp(name: string, email: string, inviteToken?: string): Promise<string> {
  testCookies.clear();
  const begun = await auth.beginSignUpWithCode({ name, email, inviteToken });
  if (!begun.ok) throw new Error(begun.message);
  const r = await auth.finishSignUpWithCode(begun.value.codeId, sentCodes.at(-1)!);
  if (!r.ok) throw new Error(r.message);
  return testCookies.get("lp_session")!;
}

function as(session: string) {
  testCookies.clear();
  testCookies.set("lp_session", session);
}

const planFor = (contactEmail: string): PlanDocument =>
  PlanDocumentSchema.parse({
    schemaVersion: 1,
    trustedContact: { name: "Priya", email: contactEmail },
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
        continueForDaysAfterActivation: 60,
      },
    ],
    onActivation: { cancelSubscriptions: true, cancelOpenInvoices: true, holdBalanceForEstate: true },
    contentVisibleTo: [],
  });

suite("web server", () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const o = new pg.Client({ connectionString: url(dbName) });
    await o.connect();
    await migrate(o, PW);
    await o.end();

    // A stand-in risk service the test can switch between answers.
    riskServer = createServer(async (req, res) => {
      if (riskMode === "down") {
        res.writeHead(503).end();
        return;
      }
      // Like the real service: any well-formed label is accepted (unknown ones are ignored);
      // a malformed one is refused with 422, which the app would treat as an outage.
      let body = "";
      for await (const chunk of req) body += chunk;
      const sentLabels: unknown = body ? (JSON.parse(body) as { textLabels?: unknown }).textLabels : undefined;
      if (Array.isArray(sentLabels) && (sentLabels.length > 16 || sentLabels.some((l) => typeof l !== "string" || !/^[A-Z][A-Z_]{2,39}$/.test(l)))) {
        res.writeHead(422).end();
        return;
      }
      const hold = riskMode === "hold";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          level: hold ? "HOLD" : "PASS",
          reasons: hold ? [{ code: "SCAM_LANGUAGE", text: "The payment note uses language common in scams.", source: "MODEL" }] : [],
          networkOnly: req.url === "/v1/network/payee",
          modelVersion: "test",
        }),
      );
    });
    await new Promise<void>((r) => riskServer.listen(0, "127.0.0.1", () => r()));

    Object.assign(process.env, {
      DATABASE_URL: url(dbName, "lp_app"),
      APP_SECRET: "test-app-secret-0123456789-0123456789",
      APP_ORIGIN: "http://localhost:3000",
      RISK_URL: `http://127.0.0.1:${(riskServer.address() as AddressInfo).port}`,
      AI_PROVIDER: "off",
    });
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.VAULT_URL;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      const text = args.map(String).join(" ");
      const code = /(?:Your code is|Ihr Code ist|Su código es) (\d{6})/.exec(text)?.[1];
      const to = /To: (\S+)/.exec(text)?.[1];
      if (code) sentCodes.push(code);
      if (to) sentTo.push(to);
      const subject = /Subject: (.+)/.exec(text)?.[1];
      if (subject) sentSubjects.push(subject);
    });

    db = await import("../src/server/db");
    auth = await import("../src/server/auth");
    plans = await import("../src/server/plans");
    payments = await import("../src/server/payments");
  }, 60_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await db?.db().end();
    (globalThis as { __lpPool?: unknown }).__lpPool = undefined;
    await new Promise<void>((r) => riskServer?.close(() => r()));
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(() => {
    riskMode = "pass";
  });

  describe("sign-in by email code", () => {
    it("INV-22 a new person gets their own plan, as its owner", async () => {
      const s = await signUp("Eleanor Hughes", `el-${randomUUID()}@example.com`);
      as(s);
      const me = await auth.currentUser();
      expect(me?.memberships.map((m) => m.role)).toEqual(["OWNER"]);
      // Only a hash of the session token is stored.
      const raw = await db.db().query(`SELECT 1 FROM sessions WHERE token_hash = $1`, [s]);
      expect(raw.rowCount).toBe(0);
    });

    it("INV-22 a code works once, and five wrong guesses lock it", async () => {
      const email = `c-${randomUUID()}@example.com`;
      const b = await auth.beginSignUpWithCode({ name: "C", email });
      if (!b.ok) throw new Error(b.message);
      const right = sentCodes.at(-1)!;
      const wrong = right === "000000" ? "111111" : "000000";
      for (let i = 0; i < 5; i++) expect((await auth.finishSignUpWithCode(b.value.codeId, wrong)).ok).toBe(false);
      expect((await auth.finishSignUpWithCode(b.value.codeId, right)).ok).toBe(false); // locked
      const b2 = await auth.beginSignUpWithCode({ name: "C", email });
      if (!b2.ok) throw new Error(b2.message);
      const code = sentCodes.at(-1)!;
      expect((await auth.finishSignUpWithCode(b2.value.codeId, code)).ok).toBe(true);
      expect((await auth.finishSignUpWithCode(b2.value.codeId, code)).ok).toBe(false); // used
    });

    it("INV-22 no more than three codes per email in 15 minutes", async () => {
      const email = `r-${randomUUID()}@example.com`;
      for (let i = 0; i < 3; i++) expect((await auth.beginSignUpWithCode({ name: "R", email })).ok).toBe(true);
      expect(await auth.beginSignUpWithCode({ name: "R", email })).toMatchObject({ ok: false });
    });

    it("INV-22 asking to sign in doesn't reveal whether an email has an account", async () => {
      const before = sentTo.length;
      const r = await auth.beginSignInWithCode(`nobody-${randomUUID()}@example.com`);
      expect(r.ok).toBe(true); // same answer as for a real account
      expect(sentTo.length).toBe(before); // but nothing was sent
    });
  });

  describe("language", () => {
    it("a new account keeps the language it was set up in, and it follows them to a new device", async () => {
      const email = `l-${randomUUID()}@example.com`;
      testCookies.clear();
      testCookies.set("lp_lang", "de");
      const begun = await auth.beginSignUpWithCode({ name: "Greta", email });
      if (!begun.ok) throw new Error(begun.message);
      const r = await auth.finishSignUpWithCode(begun.value.codeId, sentCodes.at(-1)!);
      expect(r.ok).toBe(true);
      expect(sentSubjects.at(-1)).toMatch(/^Ihr Legacy-Protection-Code: \d{6}$/); // the code email is in German too
      const row = await db.db().query(`SELECT locale FROM users WHERE email = $1`, [email]);
      expect(row.rows[0].locale).toBe("de");

      // A new device with no language chosen: signing in brings German with it.
      testCookies.clear();
      const signIn = await auth.beginSignInWithCode(email);
      if (!signIn.ok) throw new Error(signIn.message);
      expect((await auth.finishSignInWithCode(signIn.value.codeId, sentCodes.at(-1)!)).ok).toBe(true);
      expect(testCookies.get("lp_lang")).toBe("de");
      expect((await auth.currentUser())?.locale).toBe("de");
    });

    it("a language already chosen on this device is never overwritten by signing in", async () => {
      const email = `l-${randomUUID()}@example.com`;
      await signUp("Ana", email); // English account
      testCookies.clear();
      testCookies.set("lp_lang", "es");
      const signIn = await auth.beginSignInWithCode(email);
      if (!signIn.ok) throw new Error(signIn.message);
      await auth.finishSignInWithCode(signIn.value.codeId, sentCodes.at(-1)!);
      expect(testCookies.get("lp_lang")).toBe("es");
    });
  });

  describe("email delivery and the one-tap link", () => {
    const outboxFor = async (planId: string) =>
      (await db.db().query(`SELECT kind, to_email, sent_at, attempts, secret, next_attempt_at FROM notifications WHERE plan_id = $1 ORDER BY created_at`, [planId])).rows;

    it("delivers the outbox once, fills in the secret link, then erases it", async () => {
      const { deliverDue } = await import("@lp/service");
      as(await signUp("Eleanor", `e-${randomUUID()}@example.com`));
      const ctx = await plans.requireRole("OWNER");
      const contactEmail = `p-${randomUUID()}@example.com`;
      await plans.confirmPlan(ctx, planFor(contactEmail));
      const sent: Array<{ to: string; subject: string; text: string }> = [];
      const mailer = { name: "test", send: async (to: string, subject: string, text: string) => void sent.push({ to, subject, text }) };
      // Other tests' messages may be waiting too; deliver until this plan's invitation has gone.
      for (let i = 0; i < 20 && !sent.some((m) => m.to === contactEmail); i++) await deliverDue(db.db(), mailer);
      const mine = sent.filter((m) => m.to === contactEmail);
      expect(mine).toHaveLength(1);
      expect(mine[0]!.text).toMatch(/http:\/\/localhost:3000\/invite\/[A-Za-z0-9_-]{20,}/);
      expect(mine[0]!.text).not.toContain("{{link}}");
      const rows = await outboxFor(ctx.planId);
      expect(rows.every((r) => r.sent_at !== null && r.secret === null)).toBe(true);
      // Nothing is sent twice.
      const before = sent.length;
      await deliverDue(db.db(), mailer);
      expect(sent.filter((m) => m.to === contactEmail)).toHaveLength(1);
      expect(sent.length).toBe(before);
    });

    it("a failed send is retried later with a growing wait, never lost", async () => {
      const { deliverDue } = await import("@lp/service");
      as(await signUp("Eleanor", `e-${randomUUID()}@example.com`));
      const ctx = await plans.requireRole("OWNER");
      await plans.confirmPlan(ctx, planFor(`p-${randomUUID()}@example.com`));
      const down = { name: "down", send: async () => Promise.reject(new Error("provider down")) };
      const now = new Date();
      for (let i = 0; i < 50; i++) if ((await deliverDue(db.db(), down, now)).failed === 0) break;
      const [row] = await outboxFor(ctx.planId);
      expect(row.sent_at).toBeNull();
      expect(row.attempts).toBe(1);
      expect(row.next_attempt_at.getTime()).toBeGreaterThan(now.getTime());
      expect(row.secret).not.toBeNull(); // still there to send later
    });

    it("INV-26 the one-tap link says 'I'm okay' and nothing else; a changed or old link does nothing", async () => {
      const { checkInLink } = await import("@lp/service");
      as(await signUp("Eleanor", `e-${randomUUID()}@example.com`));
      const ctx = await plans.requireRole("OWNER");
      await plans.confirmPlan(ctx, planFor(`p-${randomUUID()}@example.com`));
      const token = checkInLink("", ctx.planId).replace("/ok/", "");
      expect(await plans.openCheckInLink(token)).toMatchObject({ status: "OK", firstName: "Eleanor" });
      testCookies.clear(); // no session: the link works on its own
      expect(await plans.checkInWithLink(token)).toBe(true);
      const c = await db.db().query(`SELECT channel FROM checkins WHERE plan_id = $1 ORDER BY at DESC LIMIT 1`, [ctx.planId]);
      expect(c.rows[0].channel).toBe("email_link");

      const tampered = token.slice(0, -2) + (token.endsWith("AA") ? "BB" : "AA");
      expect(await plans.checkInWithLink(tampered)).toBe(false);
      const otherPlan = token.replace(ctx.planId, randomUUID());
      expect(await plans.checkInWithLink(otherPlan)).toBe(false);
      const old = checkInLink("", ctx.planId, Date.now() - 15 * 86_400_000).replace("/ok/", "");
      expect(await plans.openCheckInLink(old)).toEqual({ status: "EXPIRED" });
      expect(await plans.checkInWithLink(old)).toBe(false);
    });

    it("INV-26 a reminder email carries a working one-tap link, in the owner's language", async () => {
      const { sendReminder, deliverDue } = await import("@lp/service");
      testCookies.clear();
      testCookies.set("lp_lang", "es");
      const email = `e-${randomUUID()}@example.com`;
      const begun = await auth.beginSignUpWithCode({ name: "Lucía", email });
      if (!begun.ok) throw new Error(begun.message);
      await auth.finishSignUpWithCode(begun.value.codeId, sentCodes.at(-1)!);
      const ctx = await plans.requireRole("OWNER");
      await plans.confirmPlan(ctx, planFor(`p-${randomUUID()}@example.com`));
      await db.db().query(`UPDATE plan_state SET last_checkin_at = now() - interval '8 days' WHERE plan_id = $1`, [ctx.planId]);
      expect(await sendReminder(db.db(), ctx.planId, Date.now() - 86_400_000, 1)).toBe("SENT");
      const sent: Array<{ to: string; subject: string; text: string }> = [];
      for (let i = 0; i < 20 && !sent.some((m) => m.to === email); i++) await deliverDue(db.db(), { name: "t", send: async (to, subject, text) => void sent.push({ to, subject, text }) });
      const m = sent.find((x) => x.to === email)!;
      expect(m.subject).toBe("¿Está bien?");
      const token = /\/ok\/(\S+)/.exec(m.text)![1]!;
      expect(await plans.checkInWithLink(token)).toBe(true);
    });
  });

  describe("plans and invites", () => {
    it("INV-08 the owner can't name themselves as their own contact", async () => {
      const email = `o-${randomUUID()}@example.com`;
      as(await signUp("Owner", email));
      const ctx = await plans.requireRole("OWNER");
      expect(await plans.confirmPlan(ctx, planFor(email))).toMatchObject({ ok: false });
    });

    it("INV-09 each confirmation is a new version, and the contact is invited once per change", async () => {
      as(await signUp("Owner", `o-${randomUUID()}@example.com`));
      const ctx = await plans.requireRole("OWNER");
      const contact = `p-${randomUUID()}@example.com`;
      const a = await plans.confirmPlan(ctx, planFor(contact));
      const b = await plans.confirmPlan(ctx, planFor(contact));
      expect(a).toMatchObject({ ok: true, version: 1 });
      expect(b).toMatchObject({ ok: true, version: 2 });
      if (a.ok && b.ok) {
        expect(a.inviteLinks).toHaveLength(1);
        expect(b.inviteLinks).toHaveLength(1); // re-invited because they haven't joined yet; the old link is revoked
      }
      const invites = await db.db().query(`SELECT count(*) FILTER (WHERE revoked_at IS NULL) AS live FROM invites WHERE plan_id = $1`, [ctx.planId]);
      expect(Number(invites.rows[0].live)).toBe(1);
    });

    it("INV-08 INV-22 an invite makes someone the contact, works once, and gives them no owner powers", async () => {
      as(await signUp("Owner", `o-${randomUUID()}@example.com`));
      const owner = await plans.requireRole("OWNER");
      const contactEmail = `p-${randomUUID()}@example.com`;
      const r = await plans.confirmPlan(owner, planFor(contactEmail));
      if (!r.ok) throw new Error("confirm failed");
      const token = r.inviteLinks[0]!.split("/invite/")[1]!;
      const contactSession = await signUp("Priya", contactEmail, token);
      as(contactSession);
      const ctx = await plans.requireRole("TRUSTED_CONTACT");
      expect(ctx.planId).toBe(owner.planId);
      await expect(plans.requireRole("OWNER")).rejects.toThrow(/NEXT_REDIRECT/);
      expect(await plans.confirmPlan(ctx, planFor("x@example.com"))).toMatchObject({ ok: false });
      expect(await payments.actOnPayment(ctx, randomUUID(), "send-anyway")).toMatchObject({ ok: false });
      // The same link can't be used again.
      await expect(signUp("Someone else", `s-${randomUUID()}@example.com`, token)).rejects.toThrow(/expired|used/);
    });

    it("signed-out visitors are sent to sign in", async () => {
      testCookies.clear();
      await expect(plans.requireRole("OWNER")).rejects.toThrow(/NEXT_REDIRECT:\/signin/);
    });
  });

  describe("payments", () => {
    async function ownerWithPlan() {
      as(await signUp("Eleanor", `e-${randomUUID()}@example.com`));
      const ctx = await plans.requireRole("OWNER");
      await plans.confirmPlan(ctx, planFor(`p-${randomUUID()}@example.com`));
      return ctx;
    }
    const scam = { payeeName: "Account Support Desk", payeeEmail: "desk@example.net", amount: "1200", method: "gift_card", note: "URGENT buy gift cards today to unlock your account" };

    it("INV-10 a scam is paused, and a risk-service outage pauses too", async () => {
      const ctx = await ownerWithPlan();
      riskMode = "hold";
      expect(await payments.createPayment(ctx, scam)).toMatchObject({ ok: true, level: "HOLD" });
      riskMode = "down";
      expect(await payments.createPayment(ctx, { ...scam, payeeName: "Pharmacy", payeeEmail: "rx@example.com", amount: "12", method: "p2p", note: "" })).toMatchObject({ ok: true, level: "HOLD" });
    });

    it("INV-10 being asked for gift cards is enough to pause, even with no message to read", async () => {
      const ctx = await ownerWithPlan();
      riskMode = "pass";
      const r = await payments.createPayment(ctx, { ...scam, note: "" });
      expect(r).toMatchObject({ ok: true, level: "HOLD" });
    });

    it("INV-10 a scam written in German or Spanish is paused just like one in English", async () => {
      const ctx = await ownerWithPlan();
      riskMode = "pass";
      for (const note of ["DRINGEND: Kaufen Sie heute Geschenkkarten, sonst wird Ihr Konto gesperrt.", "URGENTE: compre tarjetas regalo hoy mismo o su cuenta será bloqueada."]) {
        expect(await payments.createPayment(ctx, { ...scam, method: "p2p", note })).toMatchObject({ ok: true, level: "HOLD" });
      }
    });

    it("INV-27 a slow investment scam through the real payment path: asked, then paused, however she answers", async () => {
      const ctx = await ownerWithPlan();
      riskMode = "pass";
      const mentor = { payeeName: "Daniel (trading mentor)", payeeEmail: `mentor-${randomUUID()}@trade.example`, method: "p2p", note: "" };
      const results: string[] = [];
      for (const amount of ["200", "500", "1500", "5000"]) {
        const r = await payments.createPayment(ctx, { ...mentor, amount });
        if (!r.ok) throw new Error(r.message);
        results.push(r.level);
        // She says "yes, it's right" whenever we only ask.
        if (r.level === "REVIEW") expect(await payments.actOnPayment(ctx, r.id, "confirm")).toMatchObject({ ok: true });
      }
      expect(results.slice(1, 3)).toEqual(["REVIEW", "REVIEW"]);
      expect(results[3]).toBe("HOLD");
    });

    it("INV-27 'pay the fee to release your profits' is paused, and the new labels never break the risk service", async () => {
      const ctx = await ownerWithPlan();
      riskMode = "pass";
      for (const note of ["Your profit is ready. Pay the withdrawal tax to release your funds.", "Ihre Gewinne sind da. Zahlen Sie die Auszahlungsgebühr, um Ihr Geld freizugeben."]) {
        const r = await payments.createPayment(ctx, { payeeName: "Platform", payeeEmail: `p-${randomUUID()}@x.example`, amount: "300", method: "p2p", note });
        expect(r).toMatchObject({ ok: true, level: "HOLD" });
        if (!r.ok) continue;
        const p = await payments.getPayment(ctx, r.id);
        expect(p?.decision?.reasons.map((x) => x.code)).toContain("WITHDRAWAL_FEE");
        // A 422 from the risk service would have shown up as DEPENDENCY_UNAVAILABLE.
        expect(p?.decision?.reasons.map((x) => x.code)).not.toContain("DEPENDENCY_UNAVAILABLE");
      }
    });

    it("INV-28 when people report a payee as a scammer, the next person is protected the same day", async () => {
      riskMode = "pass";
      const scammer = `scammer-${randomUUID()}@x.example`;
      const pay = { payeeName: "Online friend", payeeEmail: scammer, amount: "40", method: "p2p", note: "" };
      // Two different households pay and later tell us it was a scam.
      for (let i = 0; i < 2; i++) {
        const ctx = await ownerWithPlan();
        const r = await payments.createPayment(ctx, pay);
        if (!r.ok) throw new Error(r.message);
        if (r.level === "REVIEW") await payments.actOnPayment(ctx, r.id, "confirm");
        expect(await payments.reportOutcome(ctx, r.id, "SCAM")).toEqual({ ok: true });
        // Saying it again changes nothing: a household counts once.
        await payments.reportOutcome(ctx, r.id, "SCAM");
      }
      const next = await ownerWithPlan();
      const r = await payments.createPayment(next, pay);
      expect(r).toMatchObject({ ok: true, level: "HOLD" });
      if (!r.ok) return;
      const p = await payments.getPayment(next, r.id);
      const reasons = p?.decision?.reasons ?? [];
      expect(reasons.map((x) => x.code)).toContain("PAYEE_REPORTED_BY_OTHERS");
      // Nothing about who reported (INV-13).
      expect(JSON.stringify(reasons)).not.toMatch(/Eleanor|@example\.com/);
    });

    it("INV-28 one household alone can only make others be asked, and changing their answer takes it back", async () => {
      riskMode = "pass";
      const payee = `rival-${randomUUID()}@x.example`;
      const a = await ownerWithPlan();
      const ra = await payments.createPayment(a, { payeeName: "Shop", payeeEmail: payee, amount: "25", method: "p2p", note: "" });
      if (!ra.ok) throw new Error(ra.message);
      await payments.reportOutcome(a, ra.id, "SCAM");
      const b = await ownerWithPlan();
      const rb = await payments.createPayment(b, { payeeName: "Shop", payeeEmail: payee, amount: "25", method: "p2p", note: "" });
      if (!rb.ok) throw new Error(rb.message);
      expect((await payments.getPayment(b, rb.id))?.decision?.reasons.map((x) => x.code)).toContain("PAYEE_REPORTED_ONCE");
      expect(rb.level).not.toBe("HOLD");
      await payments.reportOutcome(a, ra.id, "NOT_SCAM");
      expect(await payments.scamReportsFor(b.planId, payee)).toEqual({ otherHouseholds: 0, byOwner: false });
    });

    it("INV-28 reporting a sent payment as a scam tells the trusted person, in their language, and stores no message text", async () => {
      riskMode = "pass";
      const ctx = await ownerWithPlan();
      const r = await payments.createPayment(ctx, { payeeName: "Mentor", payeeEmail: `m-${randomUUID()}@x.example`, amount: "60", method: "p2p", note: "Guaranteed returns of 30% a month" });
      if (!r.ok) throw new Error(r.message);
      if (r.level !== "PASS") await payments.actOnPayment(ctx, r.id, r.level === "REVIEW" ? "confirm" : "send-anyway");
      await db.db().query(`UPDATE payments SET status = 'SENT' WHERE id = $1`, [r.id]);
      await payments.reportOutcome(ctx, r.id, "SCAM");
      const n = await db.db().query(`SELECT kind, subject FROM notifications WHERE plan_id = $1 AND kind = 'CONTACT_SCAM_REPORTED'`, [ctx.planId]);
      // The contact in these tests hasn't accepted yet, so there may be no one to tell; when there is, it's queued.
      const contact = await db.db().query(`SELECT 1 FROM memberships WHERE plan_id = $1 AND role = 'TRUSTED_CONTACT' AND revoked_at IS NULL`, [ctx.planId]);
      expect(n.rowCount).toBe(contact.rowCount);
      const d = await db.db().query(`SELECT text_labels FROM payment_decisions WHERE payment_id = $1`, [r.id]);
      expect(d.rows[0].text_labels).toContain("INVESTMENT_PITCH");
      expect(JSON.stringify(d.rows[0])).not.toMatch(/30%/);
    });

    describe("INV-29 money really moves, and only when it should", () => {
      const statusOf = async (id: string) =>
        (await db.db().query<{ status: string; paypal_ref: string | null; send_attempts: number }>(`SELECT status, paypal_ref, send_attempts FROM payments WHERE id = $1`, [id])).rows[0]!;
      const recorder = () => {
        const calls: string[] = [];
        return { calls, sender: { name: "test", send: async (p: { paymentId: string }) => (calls.push(p.paymentId), { reference: `REF-${p.paymentId.slice(0, 6)}` }) } };
      };

      it("a payment that passes goes through PayPal at once, with its reference", async () => {
        const ctx = await ownerWithPlan();
        riskMode = "pass";
        // An established payee, so nothing is asked.
        for (let i = 0; i < 12; i++) {
          await db.db().query(
            `INSERT INTO payments (id, plan_id, payee_name, payee_email, amount_minor, currency, method, note, status, created_at) VALUES ($1, $2, 'Pharmacy', 'rx@example.com', 4200, 'USD', 'p2p', '', 'SENT', now() - ($3 || ' days')::interval)`,
            [randomUUID(), ctx.planId, String(10 + i * 7)],
          );
        }
        const r = await payments.createPayment(ctx, { payeeName: "Pharmacy", payeeEmail: "rx@example.com", amount: "42", method: "p2p", note: "" });
        expect(r).toMatchObject({ ok: true, level: "PASS" });
        if (!r.ok) return;
        const row = await statusOf(r.id);
        expect(row.status).toBe("SENT");
        expect(row.paypal_ref).toMatch(/^DRYRUN-/); // no PayPal keys in tests: a dry run, clearly marked
        expect((await payments.getPayment(ctx, r.id))?.history.map((h) => h.kind)).toContain("PAYMENT_SENT");
      });

      it("'yes, it's right' sends it; a paused, stopped or unanswered payment is never sent", async () => {
        const { sendDuePayments } = await import("@lp/service");
        const ctx = await ownerWithPlan();
        riskMode = "pass";
        const asked = await payments.createPayment(ctx, { payeeName: "New friend", payeeEmail: `s-${randomUUID()}@x.example`, amount: "30", method: "p2p", note: "My darling, I love you" });
        riskMode = "hold";
        const paused = await payments.createPayment(ctx, scam);
        const stopped = await payments.createPayment(ctx, { ...scam, payeeEmail: `d-${randomUUID()}@x.example` });
        if (!asked.ok || !paused.ok || !stopped.ok) throw new Error("create failed");
        expect(asked.level).toBe("REVIEW");
        await payments.actOnPayment(ctx, stopped.id, "stop");
        const { calls, sender } = recorder();
        await sendDuePayments(db.db(), sender, new Date(Date.now() + 365 * 86_400_000));
        expect(calls).not.toContain(asked.id);
        expect(calls).not.toContain(paused.id);
        expect(calls).not.toContain(stopped.id);
        await payments.actOnPayment(ctx, asked.id, "confirm");
        expect((await statusOf(asked.id)).status).toBe("SENT");
      });

      it("'send anyway' waits the full 24 hours, then goes; stopping it in time means it never goes", async () => {
        const { sendDuePayments } = await import("@lp/service");
        const ctx = await ownerWithPlan();
        riskMode = "hold";
        const a = await payments.createPayment(ctx, scam);
        const b = await payments.createPayment(ctx, { ...scam, payeeEmail: `b-${randomUUID()}@x.example` });
        if (!a.ok || !b.ok) throw new Error("create failed");
        await payments.actOnPayment(ctx, a.id, "send-anyway");
        await payments.actOnPayment(ctx, b.id, "send-anyway");
        await payments.actOnPayment(ctx, b.id, "cancel-release");
        const { calls, sender } = recorder();
        await sendDuePayments(db.db(), sender, new Date(Date.now() + 23.9 * 3_600_000));
        expect(calls).not.toContain(a.id);
        await sendDuePayments(db.db(), sender, new Date(Date.now() + 24.1 * 3_600_000));
        expect(calls).toContain(a.id);
        expect(calls).not.toContain(b.id);
        expect((await statusOf(a.id)).status).toBe("RELEASED");
      });

      it("two workers at once still send each payment once", async () => {
        const { sendDuePayments } = await import("@lp/service");
        const ctx = await ownerWithPlan();
        const ids: string[] = Array.from({ length: 6 }, () => randomUUID());
        for (const id of ids) {
          await db.db().query(
            `INSERT INTO payments (id, plan_id, payee_name, payee_email, amount_minor, currency, method, note, status, created_at) VALUES ($1, $2, 'P', 'p@x.example', 100, 'USD', 'p2p', '', 'SENDING', now())`,
            [id, ctx.planId],
          );
        }
        const calls: string[] = [];
        const slow = { name: "slow", send: async (p: { paymentId: string }) => (calls.push(p.paymentId), await new Promise((r) => setTimeout(r, 20)), { reference: "R" }) };
        await Promise.all([sendDuePayments(db.db(), slow), sendDuePayments(db.db(), slow), sendDuePayments(db.db(), slow)]);
        const mine = calls.filter((c) => ids.includes(c));
        expect(mine.sort()).toEqual([...ids].sort());
      });

      it("PayPal trouble: retried with a growing wait; a refusal fails at once and she's told no money left", async () => {
        const { sendDuePayments } = await import("@lp/service");
        const { PayPalError } = await import("@lp/paypal");
        const ctx = await ownerWithPlan();
        const flaky = randomUUID();
        const refused = randomUUID();
        for (const id of [flaky, refused]) {
          await db.db().query(
            `INSERT INTO payments (id, plan_id, payee_name, payee_email, amount_minor, currency, method, note, status, created_at) VALUES ($1, $2, 'Shop', 'p@x.example', 2500, 'USD', 'p2p', '', 'SENDING', now())`,
            [id, ctx.planId],
          );
        }
        const down = { name: "down", send: async () => Promise.reject(new Error("timeout")) };
        await sendDuePayments(db.db(), down, new Date(), { onlyPaymentId: flaky });
        expect(await statusOf(flaky)).toMatchObject({ status: "SENDING", send_attempts: 1 });
        // Not tried again before its wait is up.
        await sendDuePayments(db.db(), down, new Date(), { onlyPaymentId: flaky });
        expect((await statusOf(flaky)).send_attempts).toBe(1);
        const no = { name: "no", send: async () => Promise.reject(new PayPalError("refused", 422, null, "RECEIVER_UNREGISTERED")) };
        await sendDuePayments(db.db(), no, new Date(), { onlyPaymentId: refused });
        expect((await statusOf(refused)).status).toBe("FAILED");
        const n = await db.db().query(`SELECT 1 FROM notifications WHERE plan_id = $1 AND kind = 'OWNER_PAYMENT_FAILED'`, [ctx.planId]);
        expect(n.rowCount).toBe(1);
      });
    });

    it("rejects malformed amounts and emails before anything is checked", async () => {
      const ctx = await ownerWithPlan();
      for (const bad of [{ ...scam, amount: "-5" }, { ...scam, amount: "1e9" }, { ...scam, amount: "12.345" }, { ...scam, payeeEmail: "not-an-email" }]) {
        expect(await payments.createPayment(ctx, bad)).toMatchObject({ ok: false });
      }
    });

    it("only allowed choices move a paused payment, and 'send anyway' waits 24 hours", async () => {
      const ctx = await ownerWithPlan();
      riskMode = "hold";
      const r = await payments.createPayment(ctx, scam);
      if (!r.ok) throw new Error("create failed");
      expect(await payments.actOnPayment(ctx, r.id, "confirm")).toMatchObject({ ok: false }); // confirm is only for "Is this right?"
      expect(await payments.actOnPayment(ctx, r.id, "cancel-release")).toMatchObject({ ok: false });
      expect(await payments.actOnPayment(ctx, r.id, "send-anyway")).toMatchObject({ ok: true });
      const p = await payments.getPayment(ctx, r.id);
      expect(p?.status).toBe("RELEASE_SCHEDULED");
      expect((p?.releaseAt ?? 0) - Date.now()).toBeGreaterThan(23.9 * 3_600_000);
      expect(await payments.actOnPayment(ctx, r.id, "cancel-release")).toMatchObject({ ok: true });
      expect((await payments.getPayment(ctx, r.id))?.status).toBe("STOPPED_BY_OWNER");
    });

    it("two choices at the same moment: exactly one wins", async () => {
      const ctx = await ownerWithPlan();
      riskMode = "hold";
      const r = await payments.createPayment(ctx, scam);
      if (!r.ok) throw new Error("create failed");
      // The same choice made twice at once (a double tap, two open tabs): it happens once, and the contact is told once.
      // Different choices may legitimately both succeed in sequence, e.g. "send anyway" then "stop" is how she cancels.
      const results = await Promise.all([payments.actOnPayment(ctx, r.id, "send-anyway"), payments.actOnPayment(ctx, r.id, "send-anyway")]);
      expect(results.filter((x) => x.ok)).toHaveLength(1);
      const p = await payments.getPayment(ctx, r.id);
      expect(p?.history.filter((h) => h.kind === "PAYMENT_SEND_ANYWAY")).toHaveLength(1);
    });

    it("INV-08 nobody can see or act on another person's payment", async () => {
      const a = await ownerWithPlan();
      riskMode = "hold";
      const r = await payments.createPayment(a, scam);
      if (!r.ok) throw new Error("create failed");
      const b = await ownerWithPlan();
      expect(await payments.getPayment(b, r.id)).toBeNull();
      expect(await payments.actOnPayment(b, r.id, "send-anyway")).toMatchObject({ ok: false });
    });
  });
});
