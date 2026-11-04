"use client";

import { useState, useTransition } from "react";
import { Panel, buttonStyles } from "@/components/app/ui";
import { talkAboutPaymentAction } from "../../actions";

type Turn = { role: "user" | "assistant"; content: string };

/** A calm helper for a paused payment. It can explain and listen; it can never send or release money. */
export function TalkItThrough({ paymentId }: { paymentId: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [off, setOff] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const send = (text: string | null) =>
    start(async () => {
      const next: Turn[] = text ? [...turns, { role: "user", content: text }] : turns;
      if (text) setTurns(next);
      setDraft("");
      const r = await talkAboutPaymentAction(paymentId, next);
      if (r.ok) setTurns([...next, { role: "assistant", content: r.reply }]);
      else setOff(r.reason === "AI_OFF" ? "The helper isn’t switched on here yet." : "The helper can’t answer right now. You can still decide below, or talk to someone you trust.");
    });

  if (turns.length === 0) {
    return (
      <div>
        <button type="button" onClick={() => send(null)} disabled={pending} className={buttonStyles.soft}>
          {pending ? "One moment…" : "Talk it through with me"}
        </button>
        {off && <p className="mt-2 text-center text-[15px] text-ink-soft">{off}</p>}
      </div>
    );
  }

  return (
    <Panel aria-labelledby="talk-h" className="space-y-3">
      <h2 id="talk-h" className="text-[17px] font-semibold">
        Talking it through
      </h2>
      <ol className="space-y-3" aria-live="polite">
        {turns.map((t, i) => (
          <li key={i} className={`rounded-2xl px-4 py-3 text-[17px] leading-[1.5] ${t.role === "assistant" ? "bg-mist/80" : "ml-8 bg-sage/60"}`}>
            {t.content}
          </li>
        ))}
      </ol>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) send(draft.trim());
        }}
      >
        <label className="sr-only" htmlFor="talk-input">
          Your reply
        </label>
        <input
          id="talk-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={600}
          placeholder="What did they tell you?"
          className="min-w-0 flex-1 rounded-full bg-white px-4 py-3 text-[16px] shadow-[inset_0_0_0_1.5px_rgba(16,36,27,0.12)]"
        />
        <button type="submit" disabled={pending || !draft.trim()} className="rounded-full bg-green px-5 text-[16px] font-semibold text-white disabled:opacity-50">
          {pending ? "…" : "Send"}
        </button>
      </form>
      <p className="text-[13px] text-ink-soft">This helper can explain, but it can’t send or release money. Only you decide, below. We don’t keep this conversation.</p>
      {off && <p className="text-[15px] text-ink-soft">{off}</p>}
    </Panel>
  );
}
