import { canViewContent } from "@lp/policy";
import { auditTrail, story, verifyAudit } from "@/server/world";

export const dynamic = "force-dynamic";

/** The executor package as a machine-readable file, including the sealed audit trail so anyone can re-check it. */
export function GET() {
  const s = story();
  if (!s.run) return new Response("The executor package is prepared only after the plan starts.", { status: 404 });
  const notes = canViewContent("EXECUTOR", s.plan.contentVisibleTo);
  const body = {
    kind: "legacy-protection.executor-package",
    note: "Demo data. Concept built for PayPal; not an official PayPal product.",
    owner: s.owner.name,
    planVersion: s.planVersion,
    activatedAt: new Date(s.run.activatedAt).toISOString(),
    balanceHeldForEstate: { value: (s.account.balanceMinor / 100).toFixed(2), currency: "USD" },
    steps: s.run.steps.map((st) => ({ ...st, ...(st.type === "PAY_OBLIGATION" ? { dueAt: new Date(st.dueAt).toISOString() } : {}) })),
    subscriptions: s.account.subscriptions,
    invoices: s.account.invoices,
    payments: s.payments.map((p) => ({
      payee: p.payeeName,
      amount: (p.amountMinor / 100).toFixed(2),
      status: p.status,
      createdAt: new Date(p.createdAt).toISOString(),
      ...(notes ? { note: p.note } : {}),
    })),
    audit: { verification: verifyAudit(), algorithm: "sha256 over [seq, at, actor, type, text, prevHash]", entries: auditTrail() },
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": 'attachment; filename="executor-package.json"',
    },
  });
}
