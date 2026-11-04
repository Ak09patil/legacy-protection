import { Heading, Panel } from "@/components/app/ui";
import { getI18n } from "@/i18n/server";
import { INTL_LOCALE } from "@/i18n/config";
import { db } from "@/server/db";
import { openJson } from "@lp/vault";
import type { ExecutionStep } from "@lp/policy";
import { auditFor, requireRole, snapshot } from "@/server/plans";
import { webVault } from "@/server/vault";

export const dynamic = "force-dynamic";

export default async function ExecutorPage() {
  const ctx = await requireRole("EXECUTOR");
  const { t, money, locale } = await getI18n();
  const day = (ms: number, timeZone: string) => new Intl.DateTimeFormat(INTL_LOCALE[locale], { weekday: "short", month: "short", day: "numeric", timeZone }).format(ms);
  const s = await snapshot(ctx.planId, "executor_view");
  const started = ["ACTIVATED", "EXECUTING", "COMPLETED"].includes(s.state.phase);

  // INV-08: until the plan starts, the executor sees nothing about the account.
  if (!started || !s.confirmed) {
    return (
      <div className="mx-auto max-w-[34rem] space-y-5 pt-10 text-center">
        <Heading className="text-[clamp(2rem,7vw,2.6rem)]">{t.executor.nothingTitle}</Heading>
        <p className="text-[18px] leading-[1.6] text-ink-soft">{t.executor.nothingLead(s.owner.firstName)}</p>
      </div>
    );
  }

  const tz = s.confirmed.document.checkin.timeZone;
  const [steps, audit] = await Promise.all([
    db().query<{ id: string; label: string; due_at: Date; status: string; paypal_request_id: string; step: unknown }>(
      `SELECT id, label, due_at, status, paypal_request_id, step FROM execution_steps WHERE plan_id = $1 ORDER BY due_at, id`,
      [ctx.planId],
    ),
    auditFor(ctx.planId),
  ]);
  // Steps are sealed in the database; the executor's view opens them (INV-24).
  const names = new Map(s.confirmed.document.obligations.map((o) => [o.id, o.payeeName]));
  const rows = await Promise.all(
    steps.rows.map(async (r) => {
      const step = (await openJson(webVault(), ctx.planId, "plan_document", r.step, "executor_view")) as ExecutionStep;
      const label =
        step.type === "PAY_OBLIGATION"
          ? t.executor.stepPay(names.get(step.obligationId) ?? t.executor.carer, money(step.amountMinor))
          : step.type === "CANCEL_INVOICE"
            ? t.executor.stepInvoice(step.invoiceId)
            : step.type === "CANCEL_SUBSCRIPTION"
              ? t.executor.stepSubscription(step.subscriptionId)
              : r.label;
      return { ...r, step, label };
    }),
  );
  const done = rows.filter((x) => x.status === "DONE");
  const pays = rows.filter((x) => x.step.type === "PAY_OBLIGATION");

  return (
    <div className="space-y-6">
      <div className="pt-2">
        <p className="text-[17px] font-semibold text-ink-soft">{t.executor.recordOf}</p>
        <Heading className="mt-1 text-[clamp(2rem,5vw,2.8rem)]">{s.owner.name}</Heading>
        <p className="mt-2 max-w-[40rem] text-[18px] text-ink-soft">{t.executor.lead(s.confirmed.version)}</p>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <Panel>
          <p className="text-[17px] font-semibold text-ink-soft">{t.executor.balance}</p>
          <p className="mt-2 text-[18px] leading-snug">{t.executor.balanceLead}</p>
        </Panel>
        <Panel>
          <p className="text-[17px] font-semibold text-ink-soft">{t.executor.record}</p>
          <p className={`mt-2 text-[18px] font-semibold ${audit.verdict.ok ? "text-green" : "text-amber-ink"}`}>
            {audit.verdict.ok ? t.executor.intact(audit.verdict.length) : t.executor.broken(audit.verdict.brokenAtSeq ?? 0)}
          </p>
          <a href="/executor/package" className="mt-3 inline-block min-h-[48px] content-center text-[18px] font-semibold text-green underline decoration-mint decoration-2 underline-offset-[6px]">
            {t.executor.download}
          </a>
        </Panel>
      </div>
      <Panel aria-labelledby="done-h">
        <h2 id="done-h" className="text-[18px] font-semibold">{t.executor.doneTitle}</h2>
        <ul className="mt-3 divide-y divide-ink/8">
          {done.map((st) => (
            <li key={st.id} className="flex flex-wrap items-baseline justify-between gap-2 py-3 text-[18px]">
              <span>{st.label}</span>
              <span className="font-mono text-[12px] text-ink-soft">{st.paypal_request_id.slice(0, 14)}…</span>
            </li>
          ))}
        </ul>
      </Panel>
      {pays.length > 0 && (
        <Panel aria-labelledby="pay-h">
          <h2 id="pay-h" className="text-[18px] font-semibold">{t.executor.careTitle}</h2>
          <ul className="mt-3 divide-y divide-ink/8">
            {pays.map((st) => (
              <li key={st.id} className="flex justify-between py-2.5 text-[17px]">
                <span>{day(st.due_at.getTime(), tz)}</span>
                <span className="tabular-nums">{money(st.step.type === "PAY_OBLIGATION" ? st.step.amountMinor : 0)}</span>
                <span className={st.status === "DONE" ? "font-semibold text-green" : "text-ink-soft"}>{st.status === "DONE" ? t.executor.paid : t.executor.scheduled}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
