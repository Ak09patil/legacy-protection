import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function BreathingRings({ size = 200, paused = false }: { size?: number; paused?: boolean }) {
  return (
    <div aria-hidden="true" className={`breathing-rings mx-auto ${paused ? "is-paused" : ""}`} style={{ width: size, height: size }}>
      <i className="r1" />
      <i className="r2" />
      <i className="r3" />
      <i className="r4" />
    </div>
  );
}

/** Soft glass panel. Big radius, no hard border; content sits on calm, readable white. */
export function Panel({ children, className = "", ...rest }: { children: ReactNode; className?: string } & ComponentProps<"section">) {
  return (
    <section
      {...rest}
      className={`rounded-[2rem] bg-white/72 p-6 shadow-[0_24px_60px_-38px_rgba(16,36,27,0.4)] backdrop-blur-2xl sm:p-7 ${className}`}
    >
      {children}
    </section>
  );
}

const BASE =
  "inline-flex min-h-[56px] w-full items-center justify-center rounded-full px-6 py-4 text-center text-[19px] font-semibold transition-transform duration-300 ease-calm active:scale-[0.98] disabled:opacity-60";
export const buttonStyles = {
  primary: `${BASE} bg-gradient-to-br from-green-2 to-green text-white shadow-[0_16px_32px_-16px_rgba(46,94,69,0.8)] hover:-translate-y-0.5`,
  soft: `${BASE} bg-white/80 text-green shadow-[inset_0_0_0_1.5px_rgba(46,94,69,0.35)] hover:bg-white`,
  quiet: "inline-block min-h-[48px] content-center text-[18px] font-semibold text-green underline decoration-mint decoration-2 underline-offset-[6px] hover:decoration-green",
};

export function ButtonLink({ href, variant = "primary", children }: { href: string; variant?: keyof typeof buttonStyles; children: ReactNode }) {
  return (
    <Link href={href} className={buttonStyles[variant]}>
      {children}
    </Link>
  );
}

export function Pill({ tone, children }: { tone: "safe" | "paused" | "neutral"; children: ReactNode }) {
  const tones = {
    safe: "text-green",
    paused: "bg-[#FCEFD9] text-amber-ink px-3 py-1",
    neutral: "bg-white/70 text-ink-soft px-3 py-1",
  } as const;
  return <span className={`whitespace-nowrap rounded-full text-[15px] font-semibold ${tones[tone]}`}>{children}</span>;
}

export function money(minor: number): string {
  return (minor / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function Heading({ children, as: Tag = "h1", className = "" }: { children: ReactNode; as?: "h1" | "h2" | "h3"; className?: string }) {
  return (
    <Tag className={`font-display font-[400] leading-[1.12] tracking-[-0.015em] [font-variation-settings:'SOFT'_100,'opsz'_96] ${className}`}>
      {children}
    </Tag>
  );
}
