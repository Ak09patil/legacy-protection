import Link from "next/link";
import { RingsMark } from "@/components/RingsMark";
import { LanguageSwitch } from "@/components/app/LanguageSwitch";
import { I18nProvider } from "@/i18n/client";
import { getLocale } from "@/i18n/server";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <I18nProvider locale={locale}>
      <div className="aura-field" aria-hidden="true">
        <span className="f1" />
        <span className="f2" />
        <span className="f3" />
      </div>
      <div lang={locale} className="relative z-10 min-h-[100svh]">
        <header className="mx-auto flex max-w-[64rem] flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-8">
          <Link href="/" className="flex min-h-[48px] items-center gap-3 text-[17px] font-semibold">
            <RingsMark size={28} />
            Legacy Protection
          </Link>
          <LanguageSwitch />
        </header>
        <main className="mx-auto max-w-[30rem] px-5 pb-20 pt-6 sm:px-8">{children}</main>
      </div>
    </I18nProvider>
  );
}
