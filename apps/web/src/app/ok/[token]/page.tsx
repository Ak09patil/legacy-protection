import Link from "next/link";
import { cookies } from "next/headers";
import { RingsMark } from "@/components/RingsMark";
import { BreathingRings, Heading, buttonStyles } from "@/components/app/ui";
import { isLocale, LOCALE_COOKIE, DEFAULT_LOCALE } from "@/i18n/config";
import { i18nFor } from "@/i18n/server";
import { openCheckInLink } from "@/server/plans";
import { okViaLinkAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" as const };

/**
 * The page behind the "I'm okay" link in reminder emails. Opening it changes
 * nothing (email scanners open links on their own); one tap on the button does.
 */
export default async function OkPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params;
  const { done } = await searchParams;
  const link = await openCheckInLink(token);
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(chosen) ? chosen : link.status !== "EXPIRED" && isLocale(link.locale) ? link.locale : DEFAULT_LOCALE;
  const { t } = i18nFor(locale);

  return (
    <div lang={locale} className="relative z-10 min-h-[100svh]">
      <div className="aura-field" aria-hidden="true">
        <span className="f1" />
        <span className="f2" />
        <span className="f3" />
      </div>
      <header className="relative mx-auto flex max-w-[64rem] items-center px-5 py-4 sm:px-8">
        <span className="flex min-h-[48px] items-center gap-3 text-[17px] font-semibold">
          <RingsMark size={28} />
          Legacy Protection
        </span>
      </header>
      <main className="relative mx-auto max-w-[30rem] space-y-6 px-5 pb-20 pt-6 text-center sm:px-8">
        {link.status === "EXPIRED" ? (
          <>
            <Heading className="text-[clamp(2rem,7vw,2.6rem)]">{t.ok.expiredTitle}</Heading>
            <p className="text-[18px] leading-[1.6] text-ink-soft">{t.ok.expiredLead}</p>
            <Link href="/signin" className={buttonStyles.primary}>
              {t.ok.signIn}
            </Link>
          </>
        ) : link.status === "STARTED" ? (
          <>
            <Heading className="text-[clamp(2rem,7vw,2.6rem)]">{t.ok.startedTitle}</Heading>
            <p className="text-[18px] leading-[1.6] text-ink-soft">{t.ok.startedLead}</p>
            <Link href="/signin" className={buttonStyles.primary}>
              {t.ok.signIn}
            </Link>
          </>
        ) : done ? (
          <>
            <BreathingRings size={170} />
            <Heading className="text-[clamp(2rem,7vw,2.6rem)]">{t.home.protected(link.firstName)}</Heading>
            <p role="status" className="text-[19px] leading-[1.6]">
              {t.ok.done}
            </p>
          </>
        ) : (
          <>
            <BreathingRings size={170} paused />
            <Heading className="text-[clamp(2rem,7vw,2.6rem)]">{t.home.areYouOkay(link.firstName)}</Heading>
            <p className="text-[18px] leading-[1.6] text-ink-soft">{t.ok.lead}</p>
            <form action={okViaLinkAction}>
              <input type="hidden" name="token" value={token} />
              <button type="submit" className={`${buttonStyles.primary} min-h-[72px] text-[22px]`}>
                {t.home.imOkayBig}
              </button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
