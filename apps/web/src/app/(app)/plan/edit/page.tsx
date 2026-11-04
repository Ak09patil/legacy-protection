import Link from "next/link";
import type { PlanDocument } from "@lp/policy";
import { Heading } from "@/components/app/ui";
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
  const s = await snapshot(ctx.planId);
  const isNew = !s.confirmed;
  const initial = s.draft ?? s.confirmed?.document ?? STARTER;
  return (
    <div className="mx-auto max-w-[34rem] space-y-5 pt-2">
      {!isNew && (
        <Link href="/plan" className="inline-block text-[16px] font-semibold text-green">
          Back to your plan
        </Link>
      )}
      <div>
        <Heading className="text-[clamp(2rem,7vw,2.6rem)]">{isNew ? "Set up your plan" : "Change your plan"}</Heading>
        <p className="mt-2 text-[17px] text-ink-soft">
          {isNew ? "Nothing is switched on until you read it back in plain words and confirm it." : "Nothing changes until you read the new version and confirm it."}
        </p>
      </div>
      <PlanEditor initial={initial} detectTimeZone={isNew && !s.draft} />
    </div>
  );
}
