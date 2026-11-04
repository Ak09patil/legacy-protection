import { RingsMark } from "../RingsMark";

export function Closing() {
  return (
    <footer id="demo" className="relative px-5 pb-14 pt-24 sm:px-10 lg:px-16">
      <div className="mx-auto max-w-[72rem] rounded-[2.5rem] bg-ink px-8 py-16 text-mist sm:px-14 sm:py-20">
        <p className="max-w-[40rem] font-display text-[clamp(2rem,4vw,3.2rem)] font-[380] leading-[1.1] tracking-[-0.02em] [font-variation-settings:'SOFT'_100,'opsz'_144]">
          I’m still in charge, and I’m not alone.
        </p>
        <p className="mt-6 max-w-[34rem] text-[1.08rem] leading-[1.65] text-mist/75">
          That’s the feeling we built for. Watch three minutes of it working, from writing a plan to a
          scam being stopped to a family being looked after.
        </p>
        <div className="mt-10 flex flex-wrap gap-x-7 gap-y-4">
          <a
            href="https://youtube.com"
            className="rounded-full bg-sage px-7 py-4 text-[17px] font-semibold text-ink transition-transform duration-300 ease-calm hover:-translate-y-0.5"
          >
            Watch the demo
          </a>
          <a
            href="https://github.com/Ak09patil/legacy-protection"
            className="py-4 text-[17px] font-semibold text-mist underline decoration-mist/40 decoration-2 underline-offset-[6px] hover:decoration-mist"
          >
            Read the code
          </a>
        </div>
      </div>
      <div className="mx-auto mt-10 flex max-w-[72rem] flex-col gap-4 text-[0.95rem] text-ink-soft sm:flex-row sm:items-center sm:justify-between">
        <span className="flex items-center gap-3">
          <RingsMark size={22} /> Legacy Protection
        </span>
        <span className="max-w-[36rem]">
          A concept designed for PayPal by Akanksha Patil for the PayPal AI Hackathon 2026. It isn’t a
          PayPal product and runs only in PayPal’s sandbox.
        </span>
      </div>
    </footer>
  );
}
