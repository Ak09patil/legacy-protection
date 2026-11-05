/**
 * Delivering the outbox, and the one-tap "I'm okay" link.
 *
 * Messages are written to the outbox in the same transaction as the change
 * that caused them, so a message is never lost and never sent for a change
 * that didn't happen. This loop sends them. Several workers can run it at
 * once: each row is claimed with SKIP LOCKED. A failed send backs off
 * (1, 2, 4, 8, 16 minutes) and gives up after 6 tries, leaving the error for
 * the operations page. Once a message is sent, its secret link is erased.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import { unseal } from "./seal.js";

export interface Mailer {
  readonly name: string;
  send(to: string, subject: string, text: string): Promise<void>;
}

export const MAX_ATTEMPTS = 6;

/** Resend in production; printing to the console only where that's explicitly allowed. */
export function mailerFromEnv(env: Record<string, string | undefined> = process.env): Mailer {
  const key = env.RESEND_API_KEY;
  if (key) {
    return {
      name: "resend",
      async send(to, subject, text) {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: env.EMAIL_FROM ?? "Legacy Protection <onboarding@resend.dev>", to, subject, text }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`Email provider returned ${res.status}`);
      },
    };
  }
  if (env.NODE_ENV === "production" && !env.ALLOW_CONSOLE_EMAIL) throw new Error("RESEND_API_KEY is not set");
  return {
    name: "console",
    async send(to, subject, text) {
      console.log(`\n──── email (not sent: no RESEND_API_KEY) ────\nTo: ${to}\nSubject: ${subject}\n\n${text}\n─────────────────────────────────────────────\n`);
    },
  };
}

export async function deliverDue(pool: pg.Pool, mailer: Mailer, now = new Date(), batch = 20): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < batch; i++) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const r = await c.query<{ id: string; to_email: string; subject: string; body: string; secret: Buffer | null; attempts: number }>(
        `SELECT id, to_email, subject, body, secret, attempts FROM notifications
          WHERE sent_at IS NULL AND attempts < $1 AND coalesce(next_attempt_at, created_at) <= $2
          ORDER BY coalesce(next_attempt_at, created_at) LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [MAX_ATTEMPTS, now],
      );
      const m = r.rows[0];
      if (!m) {
        await c.query("COMMIT");
        break;
      }
      try {
        const body = m.secret ? m.body.replaceAll("{{link}}", unseal(m.secret)) : m.body;
        await mailer.send(m.to_email, m.subject, body);
        await c.query(`UPDATE notifications SET sent_at = $2, secret = NULL, last_error = NULL WHERE id = $1`, [m.id, now]);
        sent++;
      } catch (e) {
        const wait = 60_000 * 2 ** m.attempts;
        await c.query(`UPDATE notifications SET attempts = attempts + 1, last_error = $2, next_attempt_at = $3 WHERE id = $1`, [
          m.id,
          String(e instanceof Error ? e.message : e).slice(0, 300),
          new Date(now.getTime() + wait),
        ]);
        failed++;
      }
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }
  return { sent, failed };
}

// ---------------------------------------------------------------------------
// One-tap "I'm okay" links (INV-26)
// ---------------------------------------------------------------------------

const LINK_DAYS = 14;

function secret(): string {
  const s = process.env.APP_SECRET;
  if (!s || s.length < 32) throw new Error("APP_SECRET must be set to at least 32 characters");
  return s;
}

const mac = (planId: string, issuedAt: number) => createHmac("sha256", secret()).update(`lp-checkin-link-v1:${planId}:${issuedAt}`).digest("base64url");

/**
 * A link that lets the owner say "I'm okay" without signing in. It can do
 * nothing else: no payments, no plan changes, nothing to read. It works for
 * 14 days.
 */
export function checkInLink(origin: string, planId: string, issuedAt = Date.now()): string {
  return `${origin}/ok/${planId}.${issuedAt}.${mac(planId, issuedAt)}`;
}

export function verifyCheckInToken(token: string, now = Date.now()): { planId: string } | null {
  const m = /^([0-9a-f-]{36})\.(\d{10,16})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return null;
  const [, planId, at, given] = m as unknown as [string, string, string, string];
  const issuedAt = Number(at);
  if (issuedAt > now + 60_000 || now - issuedAt > LINK_DAYS * 86_400_000) return null;
  const want = Buffer.from(mac(planId, issuedAt));
  const got = Buffer.from(given);
  return want.length === got.length && timingSafeEqual(want, got) ? { planId } : null;
}
