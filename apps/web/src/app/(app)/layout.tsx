import Link from "next/link";
import { redirect } from "next/navigation";
import { RingsMark } from "@/components/RingsMark";
import { currentUser } from "@/server/auth";
import { signOutAction } from "../(auth)/actions";
import { NavTabs } from "@/components/app/NavTabs";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/signin");

  const tabs: Array<{ href: string; label: string; match: string[] }> = [];
  for (const m of user.memberships) {
    const first = m.ownerName.split(" ")[0];
    if (m.role === "OWNER") tabs.push({ href: "/home", label: "My protection", match: ["/home", "/payments", "/plan"] });
    if (m.role === "TRUSTED_CONTACT") tabs.push({ href: "/contact", label: `Looking out for ${first}`, match: ["/contact"] });
    if (m.role === "EXECUTOR") tabs.push({ href: "/executor", label: `${first}’s estate`, match: ["/executor"] });
  }

  return (
    <>
      <div className="aura-field" aria-hidden="true">
        <span className="f1" />
        <span className="f2" />
        <span className="f3" />
      </div>
      <div className="relative z-10 min-h-[100svh]">
        <header className="mx-auto flex max-w-[64rem] flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-8">
          <Link href="/home" className="flex items-center gap-3 whitespace-nowrap text-[16px] font-semibold">
            <RingsMark size={28} />
            Legacy Protection
          </Link>
          <div className="flex items-center gap-3">
            {tabs.length > 1 && <NavTabs tabs={tabs} />}
            <form action={signOutAction}>
              <button type="submit" className="rounded-full px-3 py-1.5 text-[14px] font-semibold text-ink-soft hover:bg-white/70 hover:text-ink">
                Sign out
              </button>
            </form>
          </div>
        </header>
        <main className="mx-auto max-w-[64rem] px-5 pb-24 pt-2 sm:px-8">{children}</main>
      </div>
    </>
  );
}
