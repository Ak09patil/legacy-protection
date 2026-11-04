import type { Chapter } from "@/lib/story";
import { ChapterMarker } from "./ChapterMarker";

/**
 * Three moments in a life, in order, so they’re numbered. The rings behind
 * change with each: calm, an amber ripple, then a second linked ring.
 */
const CHAPTERS: Array<{ id: Chapter; n: number; title: string; body: string[]; aside: string }> = [
  {
    id: "well",
    n: 1,
    title: "While you’re well",
    body: [
      "Say what matters, in your own words. Keep paying Maria on Fridays. Stop the streaming subscriptions. Priya is the one to call.",
      "We turn it into a short plan you can read in a minute, and nothing counts until you confirm it.",
    ],
    aside: "You can change it, or switch it off, whenever you like.",
  },
  {
    id: "wrong",
    n: 2,
    title: "When something looks wrong",
    body: [
      "A new payee asks for $1,200 in gift cards. We pause it before it leaves your account and tell you why, in plain words.",
      "If someone is pressing you to send it anyway, we wait a day first. Scammers rely on hurry.",
    ],
    aside: "Priya hears about it too. She can’t see your notes or move your money.",
  },
  {
    id: "cant-act",
    n: 3,
    title: "When you can’t act",
    body: [
      "If your check-ins go quiet, Priya is asked to confirm, with a passkey on her own phone. Then we wait three more days.",
      "Any sign of you stops everything. Only then does your plan run: Maria is paid, subscriptions stop, and the rest of your balance stays safe for your estate.",
    ],
    aside: "Nothing in your plan can send your money anywhere else.",
  },
];

export function Chapters() {
  return (
    <div id="how" className="relative">
      <h2 className="sr-only">How it works</h2>
      {CHAPTERS.map((c) => (
        <ChapterMarker
          key={c.id}
          chapter={c.id}
          labelledBy={`ch-${c.id}`}
          className="flex min-h-[100svh] items-center px-5 py-24 sm:px-10 lg:px-16"
        >
          <div className="max-w-[34rem] rounded-[2.25rem] bg-white/62 p-8 shadow-[0_30px_70px_-40px_rgba(16,36,27,0.35)] backdrop-blur-2xl sm:p-11">
            <p className="font-display text-[1.05rem] text-green [font-variation-settings:'SOFT'_100]">
              {c.n} of 3
            </p>
            <h3
              id={`ch-${c.id}`}
              className="mt-2 font-display text-[clamp(2rem,3.6vw,2.9rem)] font-[400] leading-[1.08] tracking-[-0.02em] [font-variation-settings:'SOFT'_100,'opsz'_96]"
            >
              {c.title}
            </h3>
            {c.body.map((p) => (
              <p key={p} className="mt-5 text-[1.12rem] leading-[1.65] text-ink">
                {p}
              </p>
            ))}
            <p className="mt-7 border-l-2 border-mint pl-4 text-[1rem] text-ink-soft">{c.aside}</p>
          </div>
        </ChapterMarker>
      ))}
    </div>
  );
}
