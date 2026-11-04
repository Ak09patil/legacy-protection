"use client";

import { useEffect, useState } from "react";
import { RingsMark } from "../RingsMark";

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#safe", label: "Why it’s safe" },
  { href: "#paypal", label: "For PayPal" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <nav
      aria-label="Main"
      className={`fixed inset-x-0 top-0 z-30 flex items-center justify-between gap-4 px-5 py-3.5 transition-[background-color,box-shadow,backdrop-filter] duration-500 sm:px-10 ${
        scrolled ? "bg-mist/80 shadow-[0_1px_0_rgba(16,36,27,0.08)] backdrop-blur-xl" : ""
      }`}
    >
      <a href="#top" className="flex items-center gap-3 whitespace-nowrap rounded-full pr-3 text-[16px] font-semibold tracking-[-0.01em] sm:text-[17px]">
        <RingsMark />
        Legacy Protection
      </a>
      <ul className="hidden items-center gap-1 rounded-full bg-white/55 px-2 py-1.5 backdrop-blur-xl md:flex">
        {LINKS.map((l) => (
          <li key={l.href}>
            <a
              href={l.href}
              className="block rounded-full px-4 py-2 text-[15px] text-ink-soft transition-colors duration-300 hover:bg-white/80 hover:text-ink"
            >
              {l.label}
            </a>
          </li>
        ))}
      </ul>
      <a
        href="#demo"
        className="whitespace-nowrap rounded-full bg-ink px-5 py-2.5 text-[15px] font-semibold text-mist transition-transform duration-300 ease-calm hover:-translate-y-0.5"
      >
        <span className="sm:hidden">Demo</span>
        <span className="hidden sm:inline">Watch the demo</span>
      </a>
    </nav>
  );
}
