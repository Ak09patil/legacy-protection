import Link from "next/link";
import { RingsMark } from "@/components/RingsMark";
import { PersonaSwitch } from "@/components/app/PersonaSwitch";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="aura-field" aria-hidden="true">
        <span className="f1" />
        <span className="f2" />
        <span className="f3" />
      </div>
      <div className="relative z-10 min-h-[100svh]">
        <header className="mx-auto flex max-w-[64rem] flex-col items-start gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <Link href="/home" className="flex items-center gap-3 whitespace-nowrap text-[16px] font-semibold">
            <RingsMark size={28} />
            Legacy Protection
          </Link>
          <PersonaSwitch />
        </header>
        <main className="mx-auto max-w-[34rem] px-5 pb-20 pt-2 sm:px-8">{children}</main>
      </div>
    </>
  );
}
