import Link from "next/link";
import { BreathingRings, ButtonLink, Heading, Panel, Pill, money } from "@/components/app/ui";
import { db } from "@/server/db";
import { requireRole, snapshot } from "@/server/plans";
import { CheckInButton } from "./CheckInButton";

export const dynamic = "force-dynamic";

const when = (ms: number, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone }).format(ms);

type PaymentRow = { id: string; payee_name: string; amount_minor: string; status: string; created_at: Date };

export default async function HomePage() {
  const ctx = await requireRole("OWNER");
  const s = await snapshot(ctx.planId);
  const first = s.owner.firstName;

  if (!s.confirmed) {
    return (
      <div className="mx-auto max-w-[34rem] space-y-5 pt-4 text-center">
        <BreathingRings size={170} />
        <Heading className="text-[clamp(2rem,7vw,2.6rem)]">Welcome, {first}</Heading>
        <p className="text-[17px] text-ink-soft">
          Two minutes to set up. You choose who looks out for you, what keeps getting paid, and how long we wait. Nothing happens without you.
        </p>
        <ButtonLink href="/plan/edit">Set up my plan</ButtonLink>
      </div>
    );
  }

  const tz = s.confirmed.document.checkin.timeZone;
  const payments = await db().query<PaymentRow>(
    `SELECT id, payee_name, amount_minor, status, created_at FROM payments WHERE plan_id = $1 ORDER BY created_at DESC LIMIT 6`,
    [ctx.planId],
  );
  const attention = payments.rows.find((p) => ["PAUSED", "WAITING_FOR_CONTACT", "RELEASE_SCHEDULED"].includes(p.status));
  const phase = s.state.phase;
  const started = phase === "ACTIVATED" || phase === "EXECUTING" || phase === "COMPLETED";
  const worried = phase === "WAITING" || s.state.contactConfirmed || s.state.checkinsMissed;
  const waitingEndsAt = s.state.waitingStartedAt !== null ? s.state.waitingStartedAt + s.state.waitingPeriodMs : null;

  if (started) {
    return (
      <div className="mx-auto max-w-[34rem] space-y-5 pt-4 text-center">
        <BreathingRings size={170} />
        <Heading className="text-[clamp(2rem,7vw,2.6rem)]">Your plan has started</Heading>
        <p className="text-[17px] text-ink-soft">Everything is happening exactly as you confirmed it. Your balance is safe for your estate.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[34rem] space-y-5">
      <div className="pt-4 text-center">
        <BreathingRings size={190} paused={worried || !!attention} />
        <Heading className="mt-5 text-[clamp(2rem,7vw,2.6rem)]">
          {worried ? `Are you all right, ${first}?` : attention ? `A payment is waiting for you, ${first}` : `You’re protected, ${first}`}
        </Heading>
        {!worried && s.nextCheckinAt && <p className="mt-2 text-[17px] text-ink-soft">Next check-in: {when(s.nextCheckinAt, tz)}</p>}
      </div>

      {worried ? (
        <>
          <div className="rounded-[2rem] bg-[#FDF3E3]/90 p-6 text-[17px] leading-[1.55] shadow-[0_24px_60px_-38px_rgba(107,63,6,0.45)] backdrop-blur-2xl">
            {waitingEndsAt ? (
              <p>
                {s.contact.name || "Your trusted contact"} told us something may have happened to you. If we don’t hear from you by{" "}
                <strong className="font-semibold">{when(waitingEndsAt, tz)}</strong>, your plan will start.
              </p>
            ) : s.state.contactConfirmed ? (
              <p>{s.contact.name || "Your trusted contact"} told us something may have happened to you. If you’re all right, let us know.</p>
            ) : (
              <p>You missed your check-in, so we’ve asked {s.contact.name || "your trusted contact"} to look in on you.</p>
            )}
          </div>
          <CheckInButton label="I’m here, I’m all right" hint={`One tap and nothing happens. We’ll let ${s.contact.name || "them"} know you’re well.`} />
        </>
      ) : attention ? (
        <Link
          href={`/payments/${attention.id}`}
          className="block rounded-[2rem] bg-[#FDF3E3]/90 p-6 shadow-[0_24px_60px_-38px_rgba(107,63,6,0.45)] backdrop-blur-2xl transition-transform duration-300 ease-calm hover:-translate-y-0.5"
        >
          <p className="text-[15px] font-semibold text-amber-ink">We paused a payment to check it with you</p>
          <p className="mt-1 font-display text-[1.6rem] leading-tight [font-variation-settings:'SOFT'_100]">
            {money(Number(attention.amount_minor))} to {attention.payee_name}
          </p>
          <p className="mt-2 text-[16px] text-ink-soft">Open it to see why, and decide what to do.</p>
        </Link>
      ) : (
        <CheckInButton />
      )}

      <Panel aria-labelledby="contact-title" className="flex items-center gap-4">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#E4F6E1] to-[#CDEBD5] text-[18px] font-semibold text-green">
          {(s.contact.name || "?")[0]}
        </div>
        <div>
          <h2 id="contact-title" className="text-[17px] font-semibold">
            {s.contact.status === "JOINED" ? `${s.contact.name} is by your side` : `Waiting for ${s.contact.name} to accept`}
          </h2>
          <p className="text-[15px] leading-snug text-ink-soft">
            {s.contact.status === "JOINED"
              ? "They hear about anything unusual. They can’t move your money."
              : "We’ve sent them an invitation. You can resend it from your plan."}
          </p>
        </div>
      </Panel>

      <Panel aria-labelledby="recent-title">
        <h2 id="recent-title" className="text-[17px] font-semibold">
          Recent payments
        </h2>
        {payments.rows.length === 0 ? (
          <p className="mt-2 text-[16px] text-ink-soft">No payments yet. Every payment you make through PayPal is checked before money leaves.</p>
        ) : (
          <ul className="mt-2 divide-y divide-ink/8">
            {payments.rows.map((p) => (
              <li key={p.id}>
                <Link href={`/payments/${p.id}`} className="flex items-baseline justify-between gap-3 py-3 text-[16px] hover:text-green">
                  <span>
                    {p.payee_name} <span className="text-ink-soft">{money(Number(p.amount_minor))}</span>
                  </span>
                  <StatusPill status={p.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <p className="text-center">
        <Link href="/plan" className="text-[17px] font-semibold text-green underline decoration-mint decoration-2 underline-offset-[6px]">
          See or change your plan
        </Link>
      </p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  switch (status) {
    case "SENT":
    case "RELEASED":
      return <Pill tone="safe">Sent</Pill>;
    case "PAUSED":
      return <Pill tone="paused">Paused</Pill>;
    case "WAITING_FOR_CONTACT":
      return <Pill tone="paused">Talking it over</Pill>;
    case "RELEASE_SCHEDULED":
      return <Pill tone="paused">Sending soon</Pill>;
    default:
      return <Pill tone="neutral">Not sent</Pill>;
  }
}
