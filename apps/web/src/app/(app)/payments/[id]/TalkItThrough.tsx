"use client";

import { useState, useTransition } from "react";
import { Panel, buttonStyles } from "@/components/app/ui";
import { useT } from "@/i18n/client";
import { talkAboutPaymentAction } from "../../actions";

type Turn = { role: "user" | "assistant"; content: string };

/** A calm helper for a paused payment. It can explain and listen; it can never send or release money. */
export function TalkItThrough({ paymentId }: { paymentId: string }) {
  const t = useT();
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
      else setOff(r.reason === "AI_OFF" ? t.payment.talk.off : t.payment.talk.down);
    });

  if (turns.length === 0) {
    return (
      <div>
        <button type="button" onClick={() => send(null)} disabled={pending} className={buttonStyles.soft}>
          {pending ? t.common.working : t.payment.talk.start}
        </button>
        {off && <p className="mt-2 text-center text-[17px] text-ink-soft">{off}</p>}
      </div>
    );
  }

  return (
    <Panel aria-labelledby="talk-h" className="space-y-3">
      <h2 id="talk-h" className="text-[18px] font-semibold">
        {t.payment.talk.title}
      </h2>
      <ol className="space-y-3" aria-live="polite">
        {turns.map((turn, i) => (
          <li key={i} className={`rounded-2xl px-4 py-3 text-[18px] leading-[1.55] ${turn.role === "assistant" ? "bg-mist/80" : "ml-8 bg-sage/60"}`}>
            {turn.content}
          </li>
        ))}
      </ol>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) send(draft.trim());
        }}
      >
        <label className="sr-only" htmlFor="talk-input">
          {t.payment.talk.replyLabel}
        </label>
        <input
          id="talk-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={600}
          placeholder={t.payment.talk.placeholder}
          className="min-h-[56px] min-w-0 flex-1 rounded-full bg-white px-5 text-[18px] shadow-[inset_0_0_0_1.5px_rgba(16,36,27,0.12)]"
        />
        <button type="submit" disabled={pending || !draft.trim()} className="min-h-[56px] rounded-full bg-green px-6 text-[18px] font-semibold text-white disabled:opacity-50">
          {pending ? "…" : t.payment.talk.send}
        </button>
      </form>
      <p className="text-[16px] text-ink-soft">{t.payment.talk.help}</p>
      {off && <p className="text-[17px] text-ink-soft">{off}</p>}
    </Panel>
  );
}
