"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Phase } from "@lp/core";
import { storyAction } from "@/app/(app)/actions";

/**
 * Judge mode. Lets a reviewer walk the whole story in two minutes by moving
 * story time forward. Every step still goes through the real state machine,
 * so a step that isn't allowed yet is refused, not faked.
 */
export function StoryControls({ phase, checkinsMissed, storyTime }: { phase: Phase; checkinsMissed: boolean; storyTime: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  const started = phase === "ACTIVATED" || phase === "EXECUTING" || phase === "COMPLETED";
  const steps = [
    {
      key: "missed" as const,
      title: "Eleanor stops checking in",
      body: "Her check-in comes and goes. Two reminders get no reply.",
      done: checkinsMissed || phase === "WAITING" || started,
      ready: phase === "MONITORING" && !checkinsMissed,
      go: "/contact",
    },
    {
      key: "confirm" as const,
      title: "Priya confirms with her passkey",
      body: "Best done from Priya’s screen, so you see what she sees.",
      done: phase === "WAITING" || started,
      ready: phase === "MONITORING" && checkinsMissed,
      go: "/contact",
      link: true,
    },
    {
      key: "wait" as const,
      title: "Three days pass with no word",
      body: "Any sign of Eleanor in this time would stop everything.",
      done: started,
      ready: phase === "WAITING",
      go: "/executor",
    },
  ];

  const run = (key: "missed" | "confirm" | "wait" | "reset", go?: string) =>
    start(async () => {
      const r = await storyAction(key);
      setMsg(r.ok ? null : (r.reason ?? "That step isn’t possible yet."));
      if (r.ok && go) {
        setOpen(false);
        router.push(go);
      }
      else router.refresh();
    });

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[min(22rem,calc(100vw-2rem))]">
      {open && (
        <div
          id="story-panel"
          className="mb-3 rounded-[1.75rem] bg-ink/95 p-5 text-mist shadow-[0_30px_70px_-30px_rgba(16,36,27,0.8)] backdrop-blur-xl"
        >
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[15px] font-semibold">Walk through the story</p>
            <p className="text-[13px] text-mist/70">{storyTime}</p>
          </div>
          <p className="mt-1 text-[13px] leading-snug text-mist/70">
            For reviewers. Moves story time forward; every step still runs through the real plan state machine.
          </p>
          <ol className="mt-4 space-y-2.5">
            {steps.map((s, i) => (
              <li key={s.key} className={`rounded-2xl p-3 ${s.ready ? "bg-white/12" : "bg-white/5"}`}>
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-bold ${
                      s.done ? "bg-mint text-ink" : s.ready ? "bg-amber text-ink" : "bg-white/15 text-mist/70"
                    }`}
                  >
                    {s.done ? "✓" : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-[14px] font-semibold ${s.done ? "text-mist/60 line-through decoration-mint/60" : ""}`}>{s.title}</p>
                    {s.ready && (
                      <>
                        <p className="mt-0.5 text-[13px] leading-snug text-mist/75">{s.body}</p>
                        {s.link ? (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => {
                              setOpen(false);
                              router.push("/contact");
                            }}
                            className="mt-2 rounded-full bg-mint px-4 py-1.5 text-[13px] font-semibold text-ink"
                          >
                            Open Priya’s screen
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => run(s.key, s.go)}
                            className="mt-2 rounded-full bg-mint px-4 py-1.5 text-[13px] font-semibold text-ink disabled:opacity-60"
                          >
                            {pending ? "Moving time…" : "Do this step"}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {msg && (
            <p role="status" className="mt-3 text-[13px] text-amber">
              {msg}
            </p>
          )}
          <p className="mt-3 text-[13px] leading-snug text-mist/70">
            Try tapping “I’m here” as Eleanor at any point before step 3 ends. Everything stops.
          </p>
          <button type="button" disabled={pending} onClick={() => run("reset", "/home")} className="mt-3 text-[13px] font-semibold text-mint underline underline-offset-4">
            Start the story again
          </button>
        </div>
      )}
      <button
        type="button"
        aria-expanded={open}
        aria-controls="story-panel"
        onClick={() => setOpen((o) => !o)}
        className="ml-auto flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-[14px] font-semibold text-mist shadow-[0_16px_40px_-16px_rgba(16,36,27,0.7)]"
      >
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${started ? "bg-mint" : phase === "WAITING" || checkinsMissed ? "bg-amber" : "bg-mint"}`} />
        {open ? "Hide story controls" : "Story controls"}
      </button>
    </div>
  );
}
