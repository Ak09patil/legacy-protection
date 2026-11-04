import { canViewContent } from "@lp/policy";
import { Heading, Panel, money } from "@/components/app/ui";
import { story, verifyAudit } from "@/server/world";

export const dynamic = "force-dynamic";

const day = (ms: number, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone }).format(ms);

export default function ExecutorPage() {
  const s = story();
  const chain = verifyAudit();

  if (!s.run) {
    return (
      <div className="mx-auto max-w-[34rem] space-y-5 pt-10 text-center">
        <Heading className="text-[clamp(2rem,7vw,2.6rem)]">Nothing to see here yet</Heading>
        <p className="text-[17px] text-ink-soft">
          The executor’s package is only prepared after {s.owner.firstName}’s plan starts. Until then, her account is hers alone.
        </p>
        <p className="text-[15px] text-ink-soft">
          Reviewers: open <strong className="font-semibold">Story controls</strong> to get here.
        </p>
      </div>
    );
  }

  const done = s.run.steps.filter((st) => st.status === "DONE");
  const payments = s.run.steps.filter((st) => st.type === "PAY_OBLIGATION");
  const carer = s.plan.obligations[0];
  const notesVisible = canViewContent("EXECUTOR", s.plan.contentVisibleTo);
  const held = s.payments.filter((p) => p.status === "PAUSED" || p.status === "WAITING_FOR_CONTACT");

  return (
    <div className="space-y-6">
      <div className="pt-2">
        <p className="text-[15px] font-semibold text-ink-soft">Executor’s package · prepared {day(s.run.activatedAt, s.timeZone)}</p>
        <Heading className="mt-1 text-[clamp(2rem,5vw,2.8rem)]">{s.owner.name}</Heading>
        <p className="mt-2 max-w-[40rem] text-[17px] text-ink-soft">
          What happened to her PayPal account under the plan she confirmed (version {s.planVersion}), and what is waiting for you.
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-[1.1fr_1fr]">
        <Panel>
          <p className="text-[15px] font-semibold text-ink-soft">Held for the estate</p>
          <p className="mt-1 font-display text-[clamp(2.4rem,6vw,3.4rem)] leading-none [font-variation-settings:'SOFT'_100]">{money(s.account.balanceMinor)}</p>
          <p className="mt-3 text-[16px] leading-snug text-ink-soft">
            Nothing in the plan can send this anywhere. It stays in her account until you claim it through PayPal’s estate process.
          </p>
        </Panel>
        <Panel>
          <p className="text-[15px] font-semibold text-ink-soft">Record of everything that happened</p>
          <p className={`mt-2 text-[17px] font-semibold ${chain.ok ? "text-green" : "text-amber-ink"}`}>
            {chain.ok ? `Intact: ${chain.length} entries, none changed` : `Broken at entry ${chain.brokenAt}`}
          </p>
          <p className="mt-2 text-[15px] leading-snug text-ink-soft">
            Each entry is sealed with the one before it, so any change shows. {chain.ok && <span className="font-mono text-[13px]">Seal {chain.head.slice(0, 12)}…</span>}
          </p>
          <a href="/executor/package" className="mt-4 inline-block text-[16px] font-semibold text-green underline decoration-mint decoration-2 underline-offset-[6px]">
            Download the package
          </a>
        </Panel>
      </div>

      <Panel aria-labelledby="done-h">
        <h2 id="done-h" className="text-[17px] font-semibold">
          Done when the plan started
        </h2>
        <ul className="mt-3 divide-y divide-ink/8">
          {done.map((st) => (
            <li key={st.id} className="flex flex-wrap items-baseline justify-between gap-2 py-3 text-[16px]">
              <span>{st.label}</span>
              <span className="font-mono text-[12px] text-ink-soft" title="PayPal-Request-Id: retried calls can never repeat this step">
                {st.requestId.slice(0, 14)}…
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      {carer && (
        <Panel aria-labelledby="carer-h">
          <h2 id="carer-h" className="text-[17px] font-semibold">
            Keeping {carer.payeeName} paid
          </h2>
          <p className="mt-1 text-[15px] text-ink-soft">
            {money(carer.amountPerPaymentMinor)} {carer.cadence === "WEEKLY" ? "each week" : carer.cadence === "BIWEEKLY" ? "every 2 weeks" : "each month"}, never
            more than {money(carer.maxPerMonthMinor)} a month, for {carer.continueForDaysAfterActivation} days. Then it stops by itself.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[26rem] text-left text-[15px]">
              <thead className="text-[13px] text-ink-soft">
                <tr>
                  <th className="py-2 font-semibold">Date</th>
                  <th className="py-2 font-semibold">Amount</th>
                  <th className="py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/8">
                {payments.map((st) =>
                  st.type === "PAY_OBLIGATION" ? (
                    <tr key={st.id}>
                      <td className="py-2.5">{day(st.dueAt, s.timeZone)}</td>
                      <td className="py-2.5 tabular-nums">{money(st.amountMinor)}</td>
                      <td className="py-2.5">{st.status === "DONE" ? <span className="font-semibold text-green">Paid</span> : <span className="text-ink-soft">Scheduled</span>}</td>
                    </tr>
                  ) : null,
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[14px] text-ink-soft">
            Weeks that would go over the monthly limit are skipped, not squeezed in. This demo records each payment step; live PayPal sandbox calls switch on once sandbox keys are added.
          </p>
        </Panel>
      )}

      <Panel aria-labelledby="pay-h">
        <h2 id="pay-h" className="text-[17px] font-semibold">
          Her recent payments
        </h2>
        <ul className="mt-3 divide-y divide-ink/8">
          {s.payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2 py-3 text-[16px]">
              <span>
                {p.payeeName} <span className="text-ink-soft">{money(p.amountMinor)}</span>
              </span>
              <span className="text-[14px] text-ink-soft">
                {held.includes(p) ? "Paused by us and never sent" : p.status === "STOPPED_BY_OWNER" ? "She chose not to send it" : "Sent"}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[14px] text-ink-soft">
          {notesVisible ? "She chose to let you read her payment notes." : "Her payment notes stay private. She didn’t choose to share them with her executor."}
        </p>
      </Panel>
    </div>
  );
}
