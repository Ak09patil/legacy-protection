import Link from "next/link";
import { redirect } from "next/navigation";
import { summarisePlan } from "@lp/policy";
import { ButtonLink, Heading, Panel } from "@/components/app/ui";
import { getI18n } from "@/i18n/server";
import type { Messages } from "@/i18n/messages";
import { requireRole, snapshot } from "@/server/plans";
import { InviteExecutor } from "./InviteExecutor";
import { CopyInvite } from "./CopyInvite";

export const dynamic = "force-dynamic";

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ confirmed?: string; invited?: string }> }) {
  const { confirmed, invited } = await searchParams;
  const ctx = await requireRole("OWNER");
  const { t, locale, date } = await getI18n();
  const s = await snapshot(ctx.planId);
  if (!s.confirmed) redirect("/plan/edit");
  const summary = summarisePlan(s.confirmed.document, locale);

  return (
    <div className="mx-auto max-w-[34rem] space-y-5 pt-2">
      <Link href="/home" className="inline-block min-h-[48px] content-center text-[17px] font-semibold text-green">
        ← {t.common.backHome}
      </Link>
      {confirmed && (
        <p role="status" className="rounded-[1.5rem] bg-sage/80 px-5 py-4 text-[18px] font-semibold text-green">
          {t.plan.savedAs(Number(confirmed))}
          {invited ? t.plan.invited(s.contact.name) : ""}
        </p>
      )}
      <div>
        <Heading className="text-[clamp(2rem,7vw,2.6rem)]">{t.plan.title}</Heading>
        <p className="mt-2 text-[18px] text-ink-soft">{t.plan.confirmedOn(s.confirmed.version, date(s.confirmed.confirmedAt))}</p>
      </div>
      <Panel>
        <ul className="space-y-4">
          {summary.map((line) => (
            <li key={line} className="flex gap-3 text-[18px] leading-[1.6]">
              <span aria-hidden="true" className="mt-2.5 h-2.5 w-2.5 shrink-0 rounded-full bg-mint" />
              {line}
            </li>
          ))}
        </ul>
      </Panel>
      <ButtonLink href="/plan/edit" variant="soft">
        {t.plan.change}
      </ButtonLink>

      <Panel aria-labelledby="people-h" className="space-y-4">
        <h2 id="people-h" className="text-[18px] font-semibold">
          {t.plan.people}
        </h2>
        <Person label={t.plan.trustedPerson} p={s.contact} t={t} />
        {s.contact.status === "INVITED" && <CopyInvite role="TRUSTED_CONTACT" name={s.contact.name} />}
        <Person label={t.plan.executor} p={s.executor} t={t} />
        {s.executor.status === "INVITED" && <CopyInvite role="EXECUTOR" name={s.executor.name} />}
        {s.executor.status === "NONE" && <InviteExecutor />}
      </Panel>

      <p className="text-center text-[16px] text-ink-soft">{t.plan.versionsKept}</p>
    </div>
  );
}

function Person({ label, p, t }: { label: string; p: { name: string; email: string; status: "NONE" | "INVITED" | "JOINED" }; t: Messages }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[18px]">
      <div>
        <p className="text-[16px] text-ink-soft">{label}</p>
        <p>{p.status === "NONE" ? t.plan.notChosen : p.name}</p>
      </div>
      <span className="text-[16px] font-semibold text-ink-soft">{p.status === "JOINED" ? t.plan.joined : p.status === "INVITED" ? t.plan.invitedStatus : ""}</span>
    </div>
  );
}
