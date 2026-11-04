import { can } from "@lp/policy";
import { BreathingRings, Heading, Panel } from "@/components/app/ui";
import { db } from "@/server/db";
import { requireRole, snapshot } from "@/server/plans";
import { ConfirmSomethingHappened } from "./ConfirmSomethingHappened";

export const dynamic = "force-dynamic";

const fmt = (ms: number, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone }).format(ms);

function ago(ms: number): string {
  const d = Math.floor((Date.now() - ms) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}

export default async function ContactPage() {
  const ctx = await requireRole("TRUSTED_CONTACT");
  const s = await snapshot(ctx.planId);
  const first = s.owner.firstName;
  const tz = s.confirmed?.document.checkin.timeZone ?? "UTC";
  const phase = s.state.phase;
  const started = phase === "ACTIVATED" || phase === "EXECUTING" || phase === "COMPLETED";
  const waiting = phase === "WAITING";
  const confirmedByMe = s.state.contactConfirmed && !waiting;
  const missed = phase === "MONITORING" && s.state.checkinsMissed && !s.state.contactConfirmed;
  const waitingEndsAt = s.state.waitingStartedAt !== null ? s.state.waitingStartedAt + s.state.waitingPeriodMs : null;
  const messages = await db().query<{ id: string; subject: string; body: string; created_at: Date }>(
    `SELECT id, subject, body, created_at FROM notifications WHERE plan_id = $1 AND recipient_id = $2 ORDER BY created_at DESC LIMIT 20`,
    [ctx.planId, ctx.user.id],
  );
  const notesShared = s.confirmed?.document.contentVisibleTo.includes("TRUSTED_CONTACT") ?? false;

  return (
    <div className="mx-auto max-w-[34rem] space-y-5">
      <div className="pt-4 text-center">
        <BreathingRings size={170} paused={missed || waiting || confirmedByMe} />
        <p className="mt-5 text-[16px] font-semibold text-ink-soft">Hi {ctx.user.name.split(" ")[0]}</p>
        <Heading className="mt-1 text-[clamp(2rem,7vw,2.6rem)]">
          {started ? `${first}’s plan has started` : waiting || confirmedByMe ? `We’ve told ${first}` : missed ? `${first} hasn’t checked in` : `${first} is doing fine`}
        </Heading>
      </div>

      {!started && !missed && !waiting && !confirmedByMe && (
        <Panel className="space-y-4">
          <p className="text-center text-[17px] leading-[1.55]">
            {s.lastCheckinAt ? (
              <>
                {first} last checked in <strong className="font-semibold">{ago(s.lastCheckinAt)}</strong>. We’ll only get in touch if something looks unusual.
              </>
            ) : (
              `${first} is still setting up. We’ll only get in touch if something looks unusual.`
            )}
          </p>
          {s.confirmed && (
            <details className="rounded-2xl bg-mist/70 px-4 py-3">
              <summary className="cursor-pointer text-[16px] font-semibold">If something has happened to {first}</summary>
              <p className="mt-2 text-[15px] text-ink-soft">
                For example, if they’re in hospital. Please try to reach them first. If you’re sure, you can tell us now rather than waiting for a missed check-in.
              </p>
              <ConfirmSomethingHappened ownerName={first} waitingDays={Math.round(s.state.waitingPeriodMs / 86_400_000)} />
            </details>
          )}
        </Panel>
      )}

      {missed && (
        <div className="rounded-[2rem] bg-[#FDF3E3]/90 p-6 shadow-[0_24px_60px_-38px_rgba(107,63,6,0.45)] backdrop-blur-2xl">
          <p className="text-[17px] leading-[1.55]">{first} missed their check-in and hasn’t answered our reminders. That can happen for lots of ordinary reasons.</p>
          <p className="mt-3 text-[17px] font-semibold">Please try to reach them first: call, message, or ask someone nearby to look in.</p>
          <ConfirmSomethingHappened ownerName={first} waitingDays={Math.round(s.state.waitingPeriodMs / 86_400_000)} />
        </div>
      )}

      {(waiting || confirmedByMe) && (
        <Panel className="space-y-3">
          <p className="text-[17px] leading-[1.55]">
            Thank you for telling us. {first} has been told by app and email. If they’re all right, one tap from them stops everything.
          </p>
          {waitingEndsAt && (
            <p className="rounded-2xl bg-mist/80 px-4 py-3 text-[17px]">
              If we don’t hear from {first} by <strong className="font-semibold">{fmt(waitingEndsAt, tz)}</strong>, their plan will start.
            </p>
          )}
          <p className="text-[15px] text-ink-soft">You don’t need to do anything else.</p>
        </Panel>
      )}

      {started && (
        <Panel>
          <p className="text-[17px] leading-[1.55]">
            Everything is happening exactly as {first} set it up. Their balance stays safe for their estate, and nobody can move it through this plan, including you.
          </p>
        </Panel>
      )}

      {messages.rows.length > 0 && (
        <Panel aria-labelledby="msgs">
          <h2 id="msgs" className="text-[17px] font-semibold">
            Messages for you
          </h2>
          <ul className="mt-3 space-y-3">
            {messages.rows.map((m) => (
              <li key={m.id} className="rounded-2xl bg-mist/70 px-4 py-3">
                <p className="text-[13px] text-ink-soft">{fmt(m.created_at.getTime(), tz)}</p>
                <p className="mt-0.5 text-[16px] font-semibold leading-snug">{m.subject}</p>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel aria-labelledby="role">
        <h2 id="role" className="text-[17px] font-semibold">
          What you can do for {first}
        </h2>
        <ul className="mt-3 space-y-2 text-[16px]">
          {can("TRUSTED_CONTACT", "TRIGGER_CONFIRM") && <Line yes>Tell us if something has happened to them</Line>}
          <Line yes>Hear about payments we paused, if they ask you to</Line>
          {!can("TRUSTED_CONTACT", "PLAN_EDIT") && <Line>Change their plan</Line>}
          {!can("TRUSTED_CONTACT", "HOLD_RELEASE") && <Line>Release a paused payment</Line>}
          {!can("TRUSTED_CONTACT", "RECEIVE_PLAN_FUNDS") && <Line>Receive money from their plan</Line>}
          {!notesShared && <Line>Read their payment notes</Line>}
        </ul>
        <p className="mt-3 text-[14px] text-ink-soft">These limits are fixed, so nobody can talk you, or anyone pretending to be you, into more.</p>
      </Panel>
    </div>
  );
}

function Line({ yes = false, children }: { yes?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span aria-hidden="true" className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[13px] font-bold ${yes ? "bg-sage text-green" : "bg-ink/6 text-ink-soft"}`}>
        {yes ? "✓" : "–"}
      </span>
      <span className={yes ? "" : "text-ink-soft"}>
        {yes ? "" : "You can’t: "}
        {children}
      </span>
    </li>
  );
}
