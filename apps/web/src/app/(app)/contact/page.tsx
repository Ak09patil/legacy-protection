import { can } from "@lp/policy";
import { BreathingRings, Heading, Panel } from "@/components/app/ui";
import { getI18n } from "@/i18n/server";
import type { Messages } from "@/i18n/messages";
import { db } from "@/server/db";
import { requireRole, snapshot } from "@/server/plans";
import { ConfirmSomethingHappened } from "./ConfirmSomethingHappened";

export const dynamic = "force-dynamic";

function ago(ms: number, t: Messages): string {
  const d = Math.floor((Date.now() - ms) / 86_400_000);
  return d <= 0 ? t.contact.today : d === 1 ? t.contact.yesterday : t.contact.daysAgo(d);
}

export default async function ContactPage() {
  const ctx = await requireRole("TRUSTED_CONTACT");
  const { t, when } = await getI18n();
  const fmt = (ms: number, timeZone: string) => when(ms, timeZone);
  const s = await snapshot(ctx.planId, "contact_view");
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
        <p className="mt-5 text-[18px] font-semibold text-ink-soft">{t.contact.hi(ctx.user.name.split(" ")[0] ?? ctx.user.name)}</p>
        <Heading className="mt-1 text-[clamp(2rem,7vw,2.6rem)]">
          {started ? t.contact.started(first) : waiting || confirmedByMe ? t.contact.told(first) : missed ? t.contact.notCheckedIn(first) : t.contact.fine(first)}
        </Heading>
      </div>

      {!started && !missed && !waiting && !confirmedByMe && (
        <Panel className="space-y-4">
          <p className="text-center text-[18px] leading-[1.6]">
            {s.lastCheckinAt ? t.contact.lastCheckIn(first, ago(s.lastCheckinAt, t)) : t.contact.stillSettingUp(first)}
          </p>
          {s.confirmed && (
            <details className="rounded-2xl bg-mist/70 px-4 py-3">
              <summary className="min-h-[48px] cursor-pointer content-center text-[18px] font-semibold">{t.contact.ifSomething(first)}</summary>
              <p className="mt-2 text-[17px] text-ink-soft">{t.contact.ifSomethingLead}</p>
              <ConfirmSomethingHappened ownerName={first} waitingDays={Math.round(s.state.waitingPeriodMs / 86_400_000)} />
            </details>
          )}
        </Panel>
      )}

      {missed && (
        <div className="rounded-[2rem] bg-[#FDF3E3]/90 p-6 shadow-[0_24px_60px_-38px_rgba(107,63,6,0.45)] backdrop-blur-2xl">
          <p className="text-[18px] leading-[1.6]">{t.contact.missedLead(first)}</p>
          <p className="mt-3 text-[18px] font-semibold">{t.contact.tryReach}</p>
          <ConfirmSomethingHappened ownerName={first} waitingDays={Math.round(s.state.waitingPeriodMs / 86_400_000)} />
        </div>
      )}

      {(waiting || confirmedByMe) && (
        <Panel className="space-y-3">
          <p className="text-[18px] leading-[1.6]">{t.contact.thanks(first)}</p>
          {waitingEndsAt && <p className="rounded-2xl bg-mist/80 px-4 py-3 text-[18px]">{t.contact.startsBy(first, fmt(waitingEndsAt, tz))}</p>}
          <p className="text-[17px] text-ink-soft">{t.contact.nothingElse}</p>
        </Panel>
      )}

      {started && (
        <Panel>
          <p className="text-[18px] leading-[1.6]">{t.contact.startedLead(first)}</p>
        </Panel>
      )}

      {messages.rows.length > 0 && (
        <Panel aria-labelledby="msgs">
          <h2 id="msgs" className="text-[18px] font-semibold">
            {t.contact.messages}
          </h2>
          <ul className="mt-3 space-y-3">
            {messages.rows.map((m) => (
              <li key={m.id} className="rounded-2xl bg-mist/70 px-4 py-3">
                <p className="text-[15px] text-ink-soft">{fmt(m.created_at.getTime(), tz)}</p>
                <p className="mt-0.5 text-[17px] font-semibold leading-snug">{m.subject}</p>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel aria-labelledby="role">
        <h2 id="role" className="text-[18px] font-semibold">
          {t.contact.canDo(first)}
        </h2>
        <ul className="mt-3 space-y-2 text-[18px]">
          {can("TRUSTED_CONTACT", "TRIGGER_CONFIRM") && <Line yes>{t.contact.canTell}</Line>}
          <Line yes>{t.contact.canHear}</Line>
          {!can("TRUSTED_CONTACT", "PLAN_EDIT") && <Line no={t.contact.youCant}>{t.contact.cantChange}</Line>}
          {!can("TRUSTED_CONTACT", "HOLD_RELEASE") && <Line no={t.contact.youCant}>{t.contact.cantRelease}</Line>}
          {!can("TRUSTED_CONTACT", "RECEIVE_PLAN_FUNDS") && <Line no={t.contact.youCant}>{t.contact.cantReceive}</Line>}
          {!notesShared && <Line no={t.contact.youCant}>{t.contact.cantRead}</Line>}
        </ul>
        <p className="mt-3 text-[16px] text-ink-soft">{t.contact.fixedLimits}</p>
      </Panel>
    </div>
  );
}

function Line({ yes = false, no = "", children }: { yes?: boolean; no?: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span aria-hidden="true" className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[13px] font-bold ${yes ? "bg-sage text-green" : "bg-ink/6 text-ink-soft"}`}>
        {yes ? "✓" : "–"}
      </span>
      <span className={yes ? "" : "text-ink-soft"}>
        {yes ? "" : no}
        {children}
      </span>
    </li>
  );
}
