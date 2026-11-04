import { ChapterMarker } from "./ChapterMarker";

const PRINCIPLES = [
  {
    title: "The AI never touches money",
    body: "It drafts your plan and explains its reasons. A fixed set of rules makes every decision, and one isolated service is the only thing allowed to act on PayPal.",
  },
  {
    title: "Every payment happens once",
    body: "Retries, crashes and restarts can’t pay Maria twice. We prove it by deliberately killing the system between payments and checking the result.",
  },
  {
    title: "Every decision leaves a sealed record",
    body: "Each entry is chained to the one before it, so nobody can quietly rewrite what happened. Your family and your executor can check it for themselves.",
  },
];

const ASKS = [
  "A trusted contact with limited, read-only visibility. PayPal already does this for teenagers with Venmo Teen Accounts; this is the same idea at the other end of life.",
  "Holding a payment for review before it’s captured, using the authorise-then-capture flow PayPal already has.",
  "A legacy setting on the account. Under the RUFADAA law adopted across most US states, a platform’s own legacy tool takes priority over a will.",
];

export function Proof() {
  return (
    <ChapterMarker chapter="proof" className="relative px-5 py-28 sm:px-10 lg:px-16">
      <div className="mx-auto max-w-[72rem]">
        <section id="safe" aria-labelledby="safe-title">
          <h2
            id="safe-title"
            className="max-w-[40rem] font-display text-[clamp(2.2rem,4.4vw,3.6rem)] font-[380] leading-[1.05] tracking-[-0.02em] [font-variation-settings:'SOFT'_100,'opsz'_144]"
          >
            Safe because of how it’s built, not because we say so.
          </h2>
          <div className="mt-14 grid gap-x-12 gap-y-10 md:grid-cols-3">
            {PRINCIPLES.map((p) => (
              <div key={p.title} className="border-t border-ink/15 pt-6">
                <h3 className="text-[1.2rem] font-semibold leading-snug">{p.title}</h3>
                <p className="mt-3 text-[1.02rem] leading-[1.65] text-ink-soft">{p.body}</p>
              </div>
            ))}
          </div>

          <p className="mt-20 max-w-[46rem] font-display text-[clamp(1.35rem,2.2vw,1.75rem)] leading-[1.45] [font-variation-settings:'SOFT'_100]">
            Americans over 60 reported $7.7 billion lost to online fraud in 2025. On our test data,
            Legacy Protection paused 89% of scam payments while holding fewer than 1 in 200 ordinary
            ones.
          </p>
          <p className="mt-4 max-w-[46rem] text-[0.95rem] text-ink-soft">
            Loss figure from the FBI Internet Crime Complaint Center’s 2025 report. Our test data is
            synthetic, calibrated to FBI and FTC reporting, and labelled as such in the model card.
          </p>
        </section>

        <section id="paypal" aria-labelledby="paypal-title" className="mt-32 grid gap-12 lg:grid-cols-[1fr_1.25fr]">
          <div>
            <h2
              id="paypal-title"
              className="font-display text-[clamp(2.2rem,4.4vw,3.6rem)] font-[380] leading-[1.05] tracking-[-0.02em] [font-variation-settings:'SOFT'_100,'opsz'_144]"
            >
              Built so PayPal could ship it.
            </h2>
            <p className="mt-6 max-w-[28rem] text-[1.08rem] leading-[1.65] text-ink-soft">
              Everything you see runs end to end in PayPal’s sandbox today. Turning it on for real
              needs three things only PayPal can switch on.
            </p>
          </div>
          <ol className="space-y-8 self-end">
            {ASKS.map((a, i) => (
              <li key={a} className="grid grid-cols-[2.5rem_1fr] gap-4">
                <span className="font-display text-[1.6rem] leading-none text-green [font-variation-settings:'SOFT'_100]">
                  {i + 1}
                </span>
                <p className="text-[1.08rem] leading-[1.65]">{a}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </ChapterMarker>
  );
}
