"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Demo affordance: view the product as each person in the story. */
const PEOPLE = [
  { href: "/home", label: "Eleanor", match: ["/home", "/payments", "/plan"] },
  { href: "/contact", label: "Priya", match: ["/contact"] },
  { href: "/executor", label: "Executor", match: ["/executor"] },
  { href: "/ops", label: "Operations", short: "Ops", match: ["/ops"] },
];

export function PersonaSwitch() {
  const path = usePathname();
  return (
    <nav aria-label="View as" className="flex max-w-full items-center gap-0.5 rounded-full bg-white/60 p-1 text-[14px] backdrop-blur-xl">
      <span className="hidden px-2 text-ink-soft sm:inline">Viewing as</span>
      {PEOPLE.map((p) => {
        const active = p.match.some((m) => path.startsWith(m));
        return (
          <Link
            key={p.href}
            href={p.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-full px-3 py-1.5 font-semibold transition-colors ${active ? "bg-ink text-mist" : "text-ink-soft hover:bg-white/80 hover:text-ink"}`}
          >
            {"short" in p ? (
              <>
                <span className="sm:hidden">{p.short}</span>
                <span className="hidden sm:inline">{p.label}</span>
              </>
            ) : (
              p.label
            )}
          </Link>
        );
      })}
    </nav>
  );
}
