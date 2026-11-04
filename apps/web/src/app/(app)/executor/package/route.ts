import { db } from "@/server/db";
import { auditFor, requireRole, snapshot } from "@/server/plans";

export const dynamic = "force-dynamic";

/** The executor's record as a file, including the sealed audit trail so anyone can re-check it. */
export async function GET() {
  const ctx = await requireRole("EXECUTOR");
  const s = await snapshot(ctx.planId);
  if (!["ACTIVATED", "EXECUTING", "COMPLETED"].includes(s.state.phase)) {
    return new Response("Available only after the plan starts.", { status: 404 });
  }
  const [steps, audit] = await Promise.all([
    db().query(`SELECT id, label, due_at, status, paypal_request_id, done_at FROM execution_steps WHERE plan_id = $1 ORDER BY due_at, id`, [ctx.planId]),
    auditFor(ctx.planId),
  ]);
  const body = {
    kind: "legacy-protection.executor-record",
    owner: s.owner.name,
    planVersion: s.confirmed?.version,
    steps: steps.rows,
    audit: { verification: audit.verdict, algorithm: "sha256(prev_hash + canonical JSON)", entries: audit.entries },
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: { "content-type": "application/json", "content-disposition": 'attachment; filename="executor-record.json"' },
  });
}
