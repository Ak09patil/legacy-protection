import Link from "next/link";
import { redirect } from "next/navigation";
import { RingsMark } from "@/components/RingsMark";
import { currentUser } from "@/server/auth";
import { signOutAction } from "../(auth)/actions";
import { NavTabs } from "@/components/app/NavTabs";
import { LanguageSwitch } from "@/components/app/LanguageSwitch";
import { I18nProvider } from "@/i18n/client";
import { getI18n } from "@/i18n/server";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/signin");
  const { locale, t } = await getI18n();

  const tabs: Array<{ href: string; label: string; match: string[] }> = [];
  for (const m of user.memberships) {
    const first = m.ownerName.split(" ")[0] ?? m.ownerName;
    if (m.role === "OWNER") tabs.push({ href: "/home", label: t.common.roleOwner, match: ["/home", "/payments", "/plan"] });
    if (m.role === "TRUSTED_CONTACT") tabs.push({ href: "/contact", label: t.common.roleContact(first), match: ["/contact"] });
    if (m.role === "EXECUTOR") tabs.push({ href: "/executor", label: t.common.roleExecutor(first), match: ["/executor"] });
  }

  return (
    <I18nProvider locale={locale}>
      <div className="aura-field" aria-hidden="true">
        <span className="f1" />
        <span className="f2" />
        <span className="f3" />
      </div>
      <div lang={locale} className="relative z-10 min-h-[100svh]">
        <header className="mx-auto flex max-w-[64rem] flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-8">
          <Link href="/home" className="flex min-h-[48px] items-center gap-3 whitespace-nowrap text-[17px] font-semibold">
            <RingsMark size={28} />
            Legacy Protection
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            {tabs.length > 1 && <NavTabs tabs={tabs} label={t.common.yourRoles} />}
            <LanguageSwitch />
            <form action={signOutAction}>
              <button type="submit" className="min-h-[44px] rounded-full px-4 text-[15px] font-semibold text-ink-soft hover:bg-white/70 hover:text-ink">
                {t.common.signOut}
              </button>
            </form>
          </div>
        </header>
        <main className="mx-auto max-w-[64rem] px-5 pb-24 pt-2 sm:px-8">{children}</main>
        {locale !== "en" && <p className="mx-auto max-w-[64rem] px-5 pb-10 text-[14px] text-ink-soft sm:px-8">{t.common.translatedNote}</p>}
      </div>
    </I18nProvider>
  );
}
