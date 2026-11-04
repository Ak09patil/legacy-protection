import { can } from "@lp/policy";
import { BreathingRings, Heading, Panel } from "@/components/app/ui";
import { story } from "@/server/world";
import { ConfirmSomethingHappened } from "./ConfirmSomethingHappened";

export const dynamic = "force-dynamic";

const fmt = (ms: number, timeZone: string, withTime = true) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
    timeZone,
  }).format(ms);

function ago(ms: number, now: number): string {
  const d = Math.floor((now - ms) / 86_400_000);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  return `${d} days ago`;
}

export default function ContactPage() {
  const s = story();
  const first = s.owner.firstName;
  const started = s.phase === "ACTIVATED" || s.phase === "EXECUTING" || s.phase === "COMPLETED";
  const worried = s.phase === "MONITORING" && s.checkinsMissed;
  const waiting = s.phase === "WAITING";

  return (
    <div className="mx-auto max-w-[34rem] space-y-5">
      <div className="pt-4 text-center">
        <BreathingRings size={170} paused={worried || waiting} />
        <p className="mt-5 text-[16px] font-semibold text-ink-soft">Hi {s.contact.name}</p>
        <Heading className="mt-1 text-[clamp(2rem,7vw,2.6rem)]">
          {started
            ? `${first}’s plan has started`
            : waiting
              ? `We’ve told ${first}`
              : worried
                ? `${first} hasn’t checked in`
                : `${first} is doing fine`}
        </Heading>
      </div>

      {!started && !worried && !waiting && (
        <Panel className="text-center">
          <p className="text-[17px] leading-[1.55]">
            {first} last checked in <strong className="font-semibold">{ago(s.lastCheckinAt, s.now)}</strong>. We’ll only get in touch if something
            looks unusual.
          </p>
        </Panel>
      )}

      {worried && (
        <div className="rounded-[2rem] bg-[#FDF3E3]/90 p-6 shadow-[0_24px_60px_-38px_rgba(107,63,6,0.45)] backdrop-blur-2xl">
          <p className="text-[17px] leading-[1.55]">
            Her check-in was due {fmt(s.dueAt, s.timeZone)}, and she hasn’t answered two reminders. That can happen for lots of ordinary reasons.
          </p>
          <p className="mt-3 text-[17px] font-semibold">Please try to reach her first: call, message, or ask someone nearby to look in.</p>
          <ConfirmSomethingHappened ownerName={first} waitingDays={Math.round(s.plan.waitingPeriodHours / 24)} />
        </div>
      )}

      {waiting && s.waitingEndsAt && (
        <Panel className="space-y-3">
          <p className="text-[17px] leading-[1.55]">
            Thank you for telling us. {first} has been told on every channel. If she’s all right, one tap from her stops everything.
          </p>
          <p className="rounded-2xl bg-mist/80 px-4 py-3 text-[17px]">
            If we don’t hear from her by <strong className="font-semibold">{fmt(s.waitingEndsAt, s.timeZone)}</strong>, her plan will start.
          </p>
          <p className="text-[15px] text-ink-soft">You don’t need to do anything else.</p>
        </Panel>
      )}

      {started && s.run && (
        <Panel className="space-y-3">
          <p className="text-[17px] leading-[1.55]">
            Everything is happening exactly as {first} set it up. Her balance stays safe for her estate, and nobody can move it through this plan,
            including you.
          </p>
          <ul className="space-y-2 text-[16px]">
            {s.run.steps
              .filter((st) => st.status === "DONE")
              .map((st) => (
                <li key={st.id} className="flex gap-3">
                  <span aria-hidden="true" className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-mint" />
                  {st.label}
                </li>
              ))}
          </ul>
        </Panel>
      )}

      {s.contactAlerts.length > 0 && (
        <Panel aria-labelledby="msgs">
          <h2 id="msgs" className="text-[17px] font-semibold">
            Messages for you
          </h2>
          <ul className="mt-3 space-y-3">
            {s.contactAlerts.map((a) => (
              <li key={a.id} className="rounded-2xl bg-mist/70 px-4 py-3">
                <p className="text-[13px] text-ink-soft">{fmt(a.at, s.timeZone)}</p>
                <p className="mt-0.5 text-[16px] leading-snug">{a.text}</p>
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
          {can("TRUSTED_CONTACT", "TRIGGER_CONFIRM") && <Line yes>Tell us if something has happened to her</Line>}
          <Line yes>Hear about payments we paused, if she asks you to</Line>
          {!can("TRUSTED_CONTACT", "PLAN_EDIT") && <Line>Change her plan</Line>}
          {!can("TRUSTED_CONTACT", "HOLD_RELEASE") && <Line>Release a paused payment</Line>}
          {!can("TRUSTED_CONTACT", "RECEIVE_PLAN_FUNDS") && <Line>Receive money from her plan</Line>}
          {!s.plan.contentVisibleTo.includes("TRUSTED_CONTACT") && <Line>Read her payment notes</Line>}
        </ul>
        <p className="mt-3 text-[14px] text-ink-soft">These limits are fixed, so nobody can talk you, or anyone pretending to be you, into more.</p>
      </Panel>
    </div>
  );
}

function Line({ yes = false, children }: { yes?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[13px] font-bold ${yes ? "bg-sage text-green" : "bg-ink/6 text-ink-soft"}`}
      >
        {yes ? "✓" : "–"}
      </span>
      <span className={yes ? "" : "text-ink-soft"}>
        {yes ? "" : "You can’t: "}
        {children}
      </span>
    </li>
  );
}
