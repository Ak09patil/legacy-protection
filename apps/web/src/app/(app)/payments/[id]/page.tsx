import Link from "next/link";
import { notFound } from "next/navigation";
import { Heading, Panel, buttonStyles } from "@/components/app/ui";
import { INTL_LOCALE } from "@/i18n/config";
import { getI18n } from "@/i18n/server";
import { getPayment } from "@/server/payments";
import { requireRole, snapshot } from "@/server/plans";
import { TalkItThrough } from "./TalkItThrough";
import { paymentAction } from "../../actions";

export const dynamic = "force-dynamic";

function Action({ id, action, label, variant }: { id: string; action: string; label: string; variant: keyof typeof buttonStyles }) {
  return (
    <form action={paymentAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value={action} />
      <button type="submit" className={buttonStyles[variant]}>
        {label}
      </button>
    </form>
  );
}


export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireRole("OWNER");
  const { t, money, locale } = await getI18n();
  const p = await getPayment(ctx, id);
  if (!p) notFound();
  const s = await snapshot(ctx.planId);
  const contact = s.contact.status === "JOINED" ? s.contact.name : null;
  const tz = s.confirmed?.document.checkin.timeZone ?? "UTC";
  const fmt = (ms: number) => new Intl.DateTimeFormat(INTL_LOCALE[locale], { weekday: "long", hour: "numeric", minute: "2-digit", timeZone: tz }).format(ms);
  const payeeIsNew = p.decision?.reasons.some((r) => r.code.startsWith("NEW_PAYEE")) ?? false;
  const open = p.status === "PAUSED" || p.status === "WAITING_FOR_CONTACT";
  const reasons = (p.decision?.reasons ?? []).filter((r, i, all) => all.findIndex((x) => x.text === r.text) === i).slice(0, 3);

  return (
    <div className="mx-auto max-w-[34rem] space-y-5 pt-2">
      <Link href="/home" className="inline-block min-h-[48px] content-center text-[17px] font-semibold text-green">
        ← {t.common.backHome}
      </Link>

      {p.status === "CONFIRM_NEEDED" || (p.decision?.level === "REVIEW" && p.status === "SENT") ? (
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-[#FCEFD9] px-4 py-1.5 text-[14px] font-semibold text-amber-ink">
            <span className="h-2 w-2 rounded-full bg-amber" aria-hidden="true" />
            {p.status === "CONFIRM_NEEDED" ? t.payment.justChecking : t.payment.confirmedByYou}
          </span>
          <Heading className="mt-4 text-[clamp(1.9rem,6vw,2.4rem)]">{p.status === "CONFIRM_NEEDED" ? t.payment.isThisRight : t.payment.sentAsConfirmed}</Heading>
        </div>
      ) : p.decision?.level === "PASS" ? (
        <div>
          <Heading className="text-[clamp(1.9rem,6vw,2.4rem)]">{t.payment.lookedNormal}</Heading>
          <p className="mt-2 text-[18px] text-ink-soft">{t.payment.lookedNormalLead}</p>
        </div>
      ) : (
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-[#FCEFD9] px-4 py-1.5 text-[14px] font-semibold text-amber-ink">
            <span className="h-2 w-2 rounded-full bg-amber" aria-hidden="true" />
            {open ? t.payment.waitingForYou : p.status === "RELEASE_SCHEDULED" ? t.payment.sendingSoon : t.payment.decided}
          </span>
          <Heading className="mt-4 text-[clamp(1.9rem,6vw,2.4rem)]">
            {p.status === "STOPPED_BY_OWNER"
              ? t.payment.notSentTitle
              : p.status === "RELEASE_SCHEDULED"
                ? t.payment.goesIn24h
                : t.payment.pausedTitle}
          </Heading>
        </div>
      )}

      <Panel aria-label={t.payment.paymentLabel}>
        <p className="text-[17px] text-ink-soft">{open ? t.payment.aboutToSend : t.payment.paymentLabel}</p>
        <p className="mt-1 text-[2.4rem] font-semibold leading-none tracking-[-0.02em]">{money(p.amountMinor)}</p>
        <p className="mt-2 text-[18px]">
          {t.payment.toPayee(p.payeeName)}
          {payeeIsNew && <span className="text-ink-soft">{t.payment.newPayeeNote}</span>}
        </p>
        {p.note && (
          <p className="mt-4 rounded-2xl bg-mist px-4 py-3 text-[17px] italic text-ink-soft">{t.payment.theirNote(p.note)}</p>
        )}
      </Panel>

      {reasons.length > 0 && (
        <Panel aria-labelledby="why-title">
          <Heading as="h2" className="text-[1.5rem]">
            <span id="why-title">{p.status === "CONFIRM_NEEDED" ? t.payment.whyAsking : t.payment.whyPaused}</span>
          </Heading>
          <ul className="mt-3 space-y-3">
            {reasons.map((r) => (
              <li key={r.code} className="flex gap-3 text-[18px] leading-[1.55]">
                <span aria-hidden="true" className="mt-1 h-6 w-6 shrink-0 rounded-full bg-[radial-gradient(circle,#FFF6E6_30%,#F6DDB0_100%)]" />
                {t.reasons[r.code] ?? r.text}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {(open || p.status === "CONFIRM_NEEDED" || p.status === "RELEASE_SCHEDULED") && <TalkItThrough paymentId={p.id} />}

      {p.status === "CONFIRM_NEEDED" && (
        <div className="space-y-3">
          <Action id={p.id} action="confirm" label={t.payment.yesSend} variant="primary" />
          <Action id={p.id} action="stop" label={t.payment.noDont} variant="soft" />
        </div>
      )}

      {open && (
        <div className="space-y-3">
          <Action id={p.id} action="stop" label={t.payment.dontSend} variant="primary" />
          {p.status === "PAUSED" && contact && <Action id={p.id} action="ask-contact" label={t.payment.talkWith(contact)} variant="soft" />}
          {p.status === "WAITING_FOR_CONTACT" && (
            <p className="text-center text-[17px] text-ink-soft">{t.payment.weToldPerson(contact ?? t.editor.myPerson)}</p>
          )}
          <form action={paymentAction} className="pt-2 text-center">
            <input type="hidden" name="id" value={p.id} />
            <input type="hidden" name="action" value="send-anyway" />
            <button type="submit" className={buttonStyles.quiet}>
              {t.payment.sendAnyway}
            </button>
            <p className="mx-auto mt-2 max-w-[26rem] text-[16px] leading-[1.55] text-ink-soft">{t.payment.sendAnywayHelp(contact)}</p>
          </form>
        </div>
      )}

      {p.status === "RELEASE_SCHEDULED" && p.releaseAt && (
        <div className="space-y-3">
          <p className="text-center text-[18px]">{t.payment.goesOn(fmt(p.releaseAt))}</p>
          <Action id={p.id} action="cancel-release" label={t.payment.stopAfterAll} variant="primary" />
        </div>
      )}

      <Panel aria-labelledby="hist-title" className="bg-white/50">
        <h2 id="hist-title" className="text-[18px] font-semibold">{t.payment.history}</h2>
        <ol className="mt-2 space-y-2 text-[17px] text-ink-soft">
          {p.history.map((h, i) => (
            <li key={i}>
              <span className="text-ink">{fmt(h.at)}</span>: {t.payment.hist[h.kind] ?? h.kind}
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
