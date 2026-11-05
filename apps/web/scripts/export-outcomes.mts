/**
 * Exports real outcomes for retraining the risk model (INV-28).
 *
 *   pnpm risk:export > outcomes.jsonl
 *   cd services/risk && python -m risk.train --real ../../outcomes.jsonl --out artifacts/candidate
 *   python -m risk.promote --candidate artifacts/candidate --real ../../outcomes.jsonl
 *
 * Anonymous by construction: households and payees become keyed hashes
 * (HMAC with APP_SECRET), and no message text leaves the database, only the
 * scam-word labels found on it (INV-17, INV-21). Runs as the database owner,
 * because it reads across households; the app itself never can.
 *
 * Each payment that left an account becomes one line:
 *   SCAM / NOT_SCAM  the owner's latest answer
 *   MATURED          sent 60+ days ago and never reported: counted as normal
 *   PENDING          too recent to know: history only, never trained on
 * Stopped payments are included only when the owner told us what they were.
 */

import { createHmac } from "node:crypto";
import pg from "pg";

const secret = process.env.APP_SECRET;
const url = process.env.DATABASE_OWNER_URL;
if (!secret || secret.length < 32) throw new Error("APP_SECRET must be set");
if (!url) throw new Error("DATABASE_OWNER_URL must be set");
const h = (kind: string, v: string) => `h:${createHmac("sha256", secret).update(`lp-export-v1:${kind}:${v}`).digest("base64url").slice(0, 22)}`;

const client = new pg.Client({ connectionString: url });
await client.connect();
const r = await client.query<{
  plan_id: string;
  payee_email: string;
  amount_minor: string;
  created_at: Date;
  method: string;
  status: string;
  text_labels: string[] | null;
  hour_local: number | null;
  outcome: string | null;
}>(`
  SELECT p.plan_id, p.payee_email, p.amount_minor, p.created_at, p.method, p.status,
         d.text_labels, d.hour_local,
         (SELECT o.outcome FROM payment_outcomes o WHERE o.payment_id = p.id ORDER BY o.at DESC, o.id DESC LIMIT 1) AS outcome
    FROM payments p
    LEFT JOIN LATERAL (SELECT text_labels, hour_local FROM payment_decisions WHERE payment_id = p.id ORDER BY id DESC LIMIT 1) d ON true
   ORDER BY p.plan_id, p.created_at`);
await client.end();

const SIXTY_DAYS = 60 * 86_400_000;
let n = 0;
for (const x of r.rows) {
  const left = x.status === "SENT" || x.status === "RELEASED";
  if (!left && !x.outcome) continue;
  const outcome = x.outcome ?? (Date.now() - x.created_at.getTime() >= SIXTY_DAYS ? "MATURED" : "PENDING");
  process.stdout.write(
    JSON.stringify({
      owner: h("household", x.plan_id),
      payee: h("payee", x.payee_email.toLowerCase()),
      amountMinor: Number(x.amount_minor),
      at: x.created_at.toISOString(),
      hourLocal: x.hour_local ?? x.created_at.getUTCHours(),
      method: x.method,
      textLabels: x.text_labels ?? [],
      outcome,
    }) + "\n",
  );
  n++;
}
console.error(`exported ${n} payments`);
