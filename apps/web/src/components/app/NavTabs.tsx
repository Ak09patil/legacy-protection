"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Shown only to someone with more than one role (e.g. an owner who is also someone else's trusted contact). */
export function NavTabs({ tabs, label }: { tabs: Array<{ href: string; label: string; match: string[] }>; label: string }) {
  const path = usePathname();
  return (
    <nav aria-label={label} className="flex max-w-full gap-0.5 overflow-x-auto rounded-full bg-white/60 p-1 text-[14px] backdrop-blur-xl">
      {tabs.map((t) => {
        const active = t.match.some((m) => path.startsWith(m));
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap min-h-[44px] content-center rounded-full px-3 font-semibold ${active ? "bg-ink text-mist" : "text-ink-soft hover:bg-white/80 hover:text-ink"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
