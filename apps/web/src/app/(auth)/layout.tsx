import Link from "next/link";
import { RingsMark } from "@/components/RingsMark";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="aura-field" aria-hidden="true">
        <span className="f1" />
        <span className="f2" />
        <span className="f3" />
      </div>
      <div className="relative z-10 min-h-[100svh]">
        <header className="mx-auto flex max-w-[64rem] items-center px-5 py-4 sm:px-8">
          <Link href="/" className="flex items-center gap-3 text-[16px] font-semibold">
            <RingsMark size={28} />
            Legacy Protection
          </Link>
        </header>
        <main className="mx-auto max-w-[28rem] px-5 pb-20 pt-6 sm:px-8">{children}</main>
      </div>
    </>
  );
}
