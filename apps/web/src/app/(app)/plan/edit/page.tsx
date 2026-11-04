import Link from "next/link";
import type { PlanDocument } from "@lp/policy";
import { Heading } from "@/components/app/ui";
import { getI18n } from "@/i18n/server";
import { requireRole, snapshot } from "@/server/plans";
import { PlanEditor } from "./PlanEditor";

export const dynamic = "force-dynamic";

const STARTER: PlanDocument = {
  schemaVersion: 1,
  trustedContact: { name: "", email: "" },
  checkin: { timeZone: "UTC", intervalDays: 7, localHour: 10, localMinute: 0 },
  waitingPeriodHours: 72,
  obligations: [],
  onActivation: { cancelSubscriptions: true, cancelOpenInvoices: true, holdBalanceForEstate: true },
  contentVisibleTo: [],
};

export default async function EditPlanPage() {
  const ctx = await requireRole("OWNER");
  const { t } = await getI18n();
  const s = await snapshot(ctx.planId);
  const isNew = !s.confirmed;
  const initial = s.draft ?? s.confirmed?.document ?? STARTER;
  return (
    <div className="mx-auto max-w-[34rem] space-y-5 pt-2">
      {!isNew && (
        <Link href="/plan" className="inline-block min-h-[48px] content-center text-[17px] font-semibold text-green">
          ← {t.editor.backToPlan}
        </Link>
      )}
      <div>
        <Heading className="text-[clamp(2rem,7vw,2.6rem)]">{isNew ? t.editor.setUpTitle : t.editor.changeTitle}</Heading>
        <p className="mt-2 text-[18px] text-ink-soft">{isNew ? t.editor.setUpLead : t.editor.changeLead}</p>
      </div>
      <PlanEditor initial={initial} detectTimeZone={isNew && !s.draft} />
    </div>
  );
}
