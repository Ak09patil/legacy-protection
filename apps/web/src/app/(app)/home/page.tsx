import Link from "next/link";
import { BreathingRings, Heading, Panel, Pill, money } from "@/components/app/ui";
import { home } from "@/server/world";
import { CheckInButton } from "./CheckInButton";

export const dynamic = "force-dynamic";

function when(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", hour: "numeric", minute: "2-digit", timeZone }).format(ms);
}

function statusFor(p: ReturnType<typeof home>["recent"][number]) {
  switch (p.status) {
    case "SENT":
      return p.decision.reasons.length === 0 && p.payeeName.startsWith("Maria")
        ? <Pill tone="safe">In your plan</Pill>
        : <Pill tone="safe">Looks normal</Pill>;
    case "PAUSED":
      return <Pill tone="paused">Paused</Pill>;
    case "WAITING_FOR_CONTACT":
      return <Pill tone="paused">Talking it over</Pill>;
    case "RELEASE_SCHEDULED":
      return <Pill tone="paused">Sending in 24 hours</Pill>;
    case "STOPPED_BY_OWNER":
      return <Pill tone="neutral">Not sent</Pill>;
    case "RELEASED":
      return <Pill tone="neutral">Sent</Pill>;
  }
}

export default function HomePage() {
  const h = home();
  const attention = h.needsAttention[0];
  const started = h.phase === "EXECUTING" || h.phase === "COMPLETED" || h.phase === "ACTIVATED";
  const someoneWorried = !started && (h.phase === "WAITING" || h.checkinsMissed);

  if (started) {
    return (
      <div className="mx-auto max-w-[34rem] space-y-5 pt-4 text-center">
        <BreathingRings size={170} />
        <Heading className="text-[clamp(2rem,7vw,2.6rem)]">Eleanor’s plan has started</Heading>
        <p className="text-[17px] text-ink-soft">
          Everything is happening exactly as she confirmed it. Her balance is safe for her estate, and {h.contact.name} and her executor have been told.
        </p>
        <p>
          <Link href="/executor" className="text-[17px] font-semibold text-green underline decoration-mint decoration-2 underline-offset-[6px]">
            See what was done
          </Link>
        </p>
      </div>
    );
  }

  if (someoneWorried) {
    return (
      <div className="mx-auto max-w-[34rem] space-y-5">
        <div className="pt-4 text-center">
          <BreathingRings size={190} paused />
          <Heading className="mt-5 text-[clamp(2rem,7vw,2.6rem)]">Are you all right, {h.owner.firstName}?</Heading>
        </div>
        <div className="rounded-[2rem] bg-[#FDF3E3]/90 p-6 shadow-[0_24px_60px_-38px_rgba(107,63,6,0.45)] backdrop-blur-2xl">
          {h.waitingEndsAt ? (
            <p className="text-[17px] leading-[1.55]">
              {h.contact.name} told us something may have happened to you. If we don’t hear from you by{" "}
              <strong className="font-semibold">{when(h.waitingEndsAt, h.timeZone)}</strong>, your plan will start.
            </p>
          ) : (
            <p className="text-[17px] leading-[1.55]">
              You missed your check-in, so we’ve asked {h.contact.name} to look in on you.
            </p>
          )}
        </div>
        <CheckInButton label="I’m here, I’m all right" hint={`One tap and nothing happens. We’ll let ${h.contact.name} know you’re well.`} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[34rem] space-y-5">
      <div className="pt-4 text-center">
        <BreathingRings size={190} paused={!!attention} />
        <Heading className="mt-5 text-[clamp(2rem,7vw,2.6rem)]">
          {attention ? `One payment is waiting for you, ${h.owner.firstName}` : `You’re protected, ${h.owner.firstName}`}
        </Heading>
        <p className="mt-2 text-[17px] text-ink-soft">
          Next check-in: {when(h.nextCheckinAt, h.timeZone)}
        </p>
      </div>

      {attention ? (
        <Link href={`/payments/${attention.id}`} className="block rounded-[2rem] bg-[#FDF3E3]/90 p-6 shadow-[0_24px_60px_-38px_rgba(107,63,6,0.45)] backdrop-blur-2xl transition-transform duration-300 ease-calm hover:-translate-y-0.5">
          <p className="text-[15px] font-semibold text-amber-ink">We paused a payment to check it with you</p>
          <p className="mt-1 font-display text-[1.6rem] leading-tight [font-variation-settings:'SOFT'_100]">
            {money(attention.amountMinor)} to {attention.payeeName}
          </p>
          <p className="mt-2 text-[16px] text-ink-soft">Open it to see why, and decide what to do.</p>
        </Link>
      ) : (
        <CheckInButton />
      )}

      <Panel aria-labelledby="contact-title" className="flex items-center gap-4">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#E4F6E1] to-[#CDEBD5] text-[18px] font-semibold text-green">
          {h.contact.name[0]}
        </div>
        <div>
          <h2 id="contact-title" className="text-[17px] font-semibold">{h.contact.name} is by your side</h2>
          <p className="text-[15px] leading-snug text-ink-soft">She hears about anything unusual. She can’t move your money.</p>
        </div>
      </Panel>

      <Panel aria-labelledby="recent-title">
        <h2 id="recent-title" className="text-[17px] font-semibold">Recent payments</h2>
        <ol className="relative mt-3 pl-6 before:absolute before:bottom-3 before:left-[6px] before:top-3 before:w-0.5 before:rounded before:bg-gradient-to-b before:from-mint before:to-mint/10">
          {h.recent.map((p) => {
            const amber = p.status !== "SENT" && p.status !== "RELEASED" && p.status !== "STOPPED_BY_OWNER";
            return (
              <li key={p.id} className="relative">
                <span
                  aria-hidden="true"
                  className={`absolute -left-[23px] top-[19px] h-3 w-3 rounded-full border-[3px] bg-white ${amber ? "border-amber" : "border-mint"}`}
                />
                <Link href={`/payments/${p.id}`} className="flex items-baseline justify-between gap-3 rounded-xl py-3 text-[16px] hover:text-green">
                  <span>
                    {p.payeeName} <span className="text-ink-soft">{money(p.amountMinor)}</span>
                  </span>
                  {statusFor(p)}
                </Link>
              </li>
            );
          })}
        </ol>
      </Panel>

      <p className="text-center">
        <Link href="/plan" className="text-[17px] font-semibold text-green underline decoration-mint decoration-2 underline-offset-[6px]">
          See or change your plan
        </Link>
      </p>
    </div>
  );
}
