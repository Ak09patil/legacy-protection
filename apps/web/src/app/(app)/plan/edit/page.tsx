import Link from "next/link";
import { Heading } from "@/components/app/ui";
import { planView } from "@/server/world";
import { PlanEditor } from "./PlanEditor";

export const dynamic = "force-dynamic";

export default function EditPlanPage() {
  const v = planView();
  return (
    <div className="space-y-5 pt-2">
      <Link href="/plan" className="inline-block text-[16px] font-semibold text-green">
        Back to your plan
      </Link>
      <div>
        <Heading className="text-[clamp(2rem,7vw,2.6rem)]">Change your plan</Heading>
        <p className="mt-2 text-[17px] text-ink-soft">
          Nothing changes until you read the new version and confirm it.
        </p>
      </div>
      <PlanEditor initial={v.plan} />
    </div>
  );
}
