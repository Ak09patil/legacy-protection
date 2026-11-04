import Link from "next/link";
import { ButtonLink, Heading, Panel } from "@/components/app/ui";
import { planView } from "@/server/world";

export const dynamic = "force-dynamic";

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ confirmed?: string }> }) {
  const { confirmed } = await searchParams;
  const v = planView();
  const date = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(v.confirmedAt);

  return (
    <div className="mx-auto max-w-[34rem] space-y-5 pt-2">
      <Link href="/home" className="inline-block text-[16px] font-semibold text-green">
        Back home
      </Link>
      {confirmed && (
        <p role="status" className="rounded-[1.5rem] bg-sage/80 px-5 py-4 text-[17px] font-semibold text-green">
          Your plan is saved. This version is now the one we follow.
        </p>
      )}
      <div>
        <Heading className="text-[clamp(2rem,7vw,2.6rem)]">Your plan</Heading>
        <p className="mt-2 text-[17px] text-ink-soft">
          Confirmed by you on {date}. This is exactly what we’ll do, in plain words.
        </p>
      </div>
      <Panel>
        <ul className="space-y-4">
          {v.summary.map((line) => (
            <li key={line} className="flex gap-3 text-[17px] leading-[1.55]">
              <span aria-hidden="true" className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-mint" />
              {line}
            </li>
          ))}
        </ul>
      </Panel>
      <ButtonLink href="/plan/edit" variant="soft">
        Change my plan
      </ButtonLink>
      <p className="text-center text-[15px] text-ink-soft">
        Changes never overwrite this version. We keep every version you’ve confirmed.
      </p>
    </div>
  );
}
