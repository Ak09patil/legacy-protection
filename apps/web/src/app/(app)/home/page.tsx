import Link from "next/link";
import { BreathingRings, ButtonLink, Heading, Panel, Pill } from "@/components/app/ui";
import { getI18n } from "@/i18n/server";
import type { Messages } from "@/i18n/messages";
import { db } from "@/server/db";
import { requireRole, snapshot } from "@/server/plans";
import { CheckInButton } from "./CheckInButton";

export const dynamic = "force-dynamic";

type PaymentRow = { id: string; payee_name: string; amount_minor: string; status: string; created_at: Date };

export default async function HomePage() {
  const ctx = await requireRole("OWNER");
  const { t, money, when } = await getI18n();
  const s = await snapshot(ctx.planId);
  const first = s.owner.firstName;

  if (!s.confirmed) {
    return (
      <div className="mx-auto max-w-[34rem] space-y-5 pt-4 text-center">
        <BreathingRings size={170} />
        <Heading className="text-[clamp(2rem,7vw,2.6rem)]">{t.home.welcome(first)}</Heading>
        <p className="text-[18px] leading-[1.6] text-ink-soft">{t.home.welcomeLead}</p>
        <ButtonLink href="/plan/edit">{t.home.setUpPlan}</ButtonLink>
      </div>
    );
  }

  const tz = s.confirmed.document.checkin.timeZone;
  const payments = await db().query<PaymentRow>(
    `SELECT id, payee_name, amount_minor, status, created_at FROM payments WHERE plan_id = $1 ORDER BY created_at DESC LIMIT 6`,
    [ctx.planId],
  );
  const attention = payments.rows.find((p) => ["CONFIRM_NEEDED", "PAUSED", "WAITING_FOR_CONTACT", "RELEASE_SCHEDULED"].includes(p.status));
  const phase = s.state.phase;
  const started = phase === "ACTIVATED" || phase === "EXECUTING" || phase === "COMPLETED";
  const worried = phase === "WAITING" || s.state.contactConfirmed || s.state.checkinsMissed;
  const waitingEndsAt = s.state.waitingStartedAt !== null ? s.state.waitingStartedAt + s.state.waitingPeriodMs : null;
  const person = s.contact.name || t.editor.myPerson;

  if (started) {
    return (
      <div className="mx-auto max-w-[34rem] space-y-5 pt-4 text-center">
        <BreathingRings size={170} />
        <Heading className="text-[clamp(2rem,7vw,2.6rem)]">{t.home.planStarted}</Heading>
        <p className="text-[18px] leading-[1.6] text-ink-soft">{t.home.planStartedLead}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[34rem] space-y-5">
      <div className="pt-4 text-center">
        <BreathingRings size={190} paused={worried || !!attention} />
        <Heading className="mt-5 text-[clamp(2rem,7vw,2.6rem)]">
          {worried ? t.home.areYouOkay(first) : attention ? t.home.paymentWaiting(first) : t.home.protected(first)}
        </Heading>
        {!worried && s.nextCheckinAt && <p className="mt-2 text-[18px] text-ink-soft">{t.home.nextCheckIn(when(s.nextCheckinAt, tz))}</p>}
      </div>

      {worried ? (
        <>
          <div className="rounded-[2rem] bg-[#FDF3E3]/90 p-6 text-[18px] leading-[1.6] shadow-[0_24px_60px_-38px_rgba(107,63,6,0.45)] backdrop-blur-2xl">
            <p>
              {waitingEndsAt
                ? t.home.worriedWaiting(person, when(waitingEndsAt, tz))
                : s.state.contactConfirmed
                  ? t.home.worriedConfirmed(person)
                  : t.home.worriedMissed(person)}
            </p>
          </div>
          <CheckInButton label={t.home.imOkayBig} hint={t.home.imOkayHint(person)} />
        </>
      ) : attention ? (
        <Link
          href={`/payments/${attention.id}`}
          className="block rounded-[2rem] bg-[#FDF3E3]/90 p-6 shadow-[0_24px_60px_-38px_rgba(107,63,6,0.45)] backdrop-blur-2xl transition-transform duration-300 ease-calm hover:-translate-y-0.5"
        >
          <p className="text-[17px] font-semibold text-amber-ink">
            {attention.status === "CONFIRM_NEEDED" ? t.home.confirmPaymentTitle : t.home.pausedPaymentTitle}
          </p>
          <p className="mt-1 font-display text-[1.7rem] leading-tight [font-variation-settings:'SOFT'_100]">
            {t.home.paymentTo(money(attention.amount_minor), attention.payee_name)}
          </p>
          <p className="mt-2 text-[17px] text-ink-soft">{t.home.openToDecide}</p>
        </Link>
      ) : (
        <CheckInButton />
      )}

      <Panel aria-labelledby="contact-title" className="flex items-center gap-4">
        <div aria-hidden="true" className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#E4F6E1] to-[#CDEBD5] text-[20px] font-semibold text-green">
          {(s.contact.name || "?")[0]}
        </div>
        <div>
          <h2 id="contact-title" className="text-[18px] font-semibold">
            {s.contact.status === "JOINED" ? t.home.personBySide(person) : t.home.personInvited(person)}
          </h2>
          <p className="text-[17px] leading-snug text-ink-soft">
            {s.contact.status === "JOINED" ? t.home.personBySideLead : t.home.personInvitedLead}
          </p>
        </div>
      </Panel>

      <Panel aria-labelledby="recent-title">
        <h2 id="recent-title" className="text-[18px] font-semibold">
          {t.home.recentPayments}
        </h2>
        {payments.rows.length === 0 ? (
          <p className="mt-2 text-[17px] text-ink-soft">{t.home.noPayments}</p>
        ) : (
          <ul className="mt-2 divide-y divide-ink/8">
            {payments.rows.map((p) => (
              <li key={p.id}>
                <Link href={`/payments/${p.id}`} className="flex min-h-[56px] items-center justify-between gap-3 py-3 text-[17px] hover:text-green">
                  <span>
                    {p.payee_name} <span className="text-ink-soft">{money(p.amount_minor)}</span>
                  </span>
                  <StatusPill status={p.status} t={t} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <ButtonLink href="/payments/new" variant="soft">
        {t.home.sendMoney}
      </ButtonLink>

      <p className="text-center">
        <Link href="/plan" className="inline-block min-h-[48px] content-center text-[18px] font-semibold text-green underline decoration-mint decoration-2 underline-offset-[6px]">
          {t.home.seePlan}
        </Link>
      </p>
    </div>
  );
}

function StatusPill({ status, t }: { status: string; t: Messages }) {
  switch (status) {
    case "SENT":
    case "RELEASED":
      return <Pill tone="safe">{t.home.statusSent}</Pill>;
    case "CONFIRM_NEEDED":
      return <Pill tone="paused">{t.home.statusCheck}</Pill>;
    case "PAUSED":
      return <Pill tone="paused">{t.home.statusPaused}</Pill>;
    case "WAITING_FOR_CONTACT":
      return <Pill tone="paused">{t.home.statusTalking}</Pill>;
    case "RELEASE_SCHEDULED":
      return <Pill tone="paused">{t.home.statusSoon}</Pill>;
    case "SENDING":
      return <Pill tone="neutral">{t.home.statusSending}</Pill>;
    default:
      return <Pill tone="neutral">{t.home.statusNotSent}</Pill>;
  }
}
