import Link from "next/link";
import { redirect } from "next/navigation";
import { ButtonLink, Heading, Panel } from "@/components/app/ui";
import { requireRole, snapshot } from "@/server/plans";
import { InviteExecutor } from "./InviteExecutor";
import { CopyInvite } from "./CopyInvite";

export const dynamic = "force-dynamic";

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ confirmed?: string; invited?: string }> }) {
  const { confirmed, invited } = await searchParams;
  const ctx = await requireRole("OWNER");
  const s = await snapshot(ctx.planId);
  if (!s.confirmed) redirect("/plan/edit");
  const tz = s.confirmed.document.checkin.timeZone;
  const date = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: tz }).format(s.confirmed.confirmedAt);

  return (
    <div className="mx-auto max-w-[34rem] space-y-5 pt-2">
      <Link href="/home" className="inline-block text-[16px] font-semibold text-green">
        Back home
      </Link>
      {confirmed && (
        <p role="status" className="rounded-[1.5rem] bg-sage/80 px-5 py-4 text-[17px] font-semibold text-green">
          Your plan is saved as version {confirmed}. {invited ? `We’ve invited ${s.contact.name} to be your trusted contact.` : ""}
        </p>
      )}
      <div>
        <Heading className="text-[clamp(2rem,7vw,2.6rem)]">Your plan</Heading>
        <p className="mt-2 text-[17px] text-ink-soft">
          Version {s.confirmed.version}, confirmed by you on {date}. This is exactly what we’ll do, in plain words.
        </p>
      </div>
      <Panel>
        <ul className="space-y-4">
          {s.confirmed.summary.map((line) => (
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

      <Panel aria-labelledby="people-h" className="space-y-4">
        <h2 id="people-h" className="text-[17px] font-semibold">
          The people in your plan
        </h2>
        <Person label="Trusted contact" p={s.contact} />
        {s.contact.status === "INVITED" && <CopyInvite role="TRUSTED_CONTACT" name={s.contact.name} />}
        <Person label="Executor" p={s.executor} />
        {s.executor.status === "INVITED" && <CopyInvite role="EXECUTOR" name={s.executor.name} />}
        {s.executor.status === "NONE" && <InviteExecutor />}
      </Panel>

      <p className="text-center text-[15px] text-ink-soft">Changes never overwrite a confirmed version. We keep every version you’ve confirmed.</p>
    </div>
  );
}

function Person({ label, p }: { label: string; p: { name: string; email: string; status: "NONE" | "INVITED" | "JOINED" } }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[16px]">
      <div>
        <p className="text-[14px] text-ink-soft">{label}</p>
        <p>{p.status === "NONE" ? "Not chosen yet" : p.name}</p>
      </div>
      <span className="text-[14px] font-semibold text-ink-soft">{p.status === "JOINED" ? "Joined" : p.status === "INVITED" ? "Invited" : ""}</span>
    </div>
  );
}
