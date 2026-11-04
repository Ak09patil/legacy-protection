"use client";

import { useState, useTransition } from "react";
import { buttonStyles } from "@/components/app/ui";
import { useT } from "@/i18n/client";
import { inviteExecutorAction } from "../actions";

const field =
  "mt-1 w-full min-h-[56px] rounded-2xl border-0 bg-white/90 px-4 py-3 text-[18px] font-normal shadow-[inset_0_0_0_1.5px_rgba(16,36,27,0.12)] focus:shadow-[inset_0_0_0_2px_#2E5E45] focus:outline-none";

export function InviteExecutor() {
  const t = useT();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string; link?: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-3 rounded-[1.5rem] bg-mist/70 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await inviteExecutorAction(name, email);
          setMsg(r.ok ? { ok: true, text: t.plan.weEmailed(name), link: r.link } : { ok: false, text: r.message });
        });
      }}
    >
      <p className="text-[17px] text-ink-soft">{t.plan.executorHelp}</p>
      <label className="block text-[18px] font-semibold">
        {t.plan.theirName}
        <input className={field} value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="block text-[18px] font-semibold">
        {t.plan.theirEmail}
        <input className={field} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <button type="submit" disabled={pending} className={buttonStyles.soft}>
        {t.plan.inviteExecutor}
      </button>
      {msg && (
        <div role="status" className={`text-[17px] ${msg.ok ? "text-green" : "text-amber-ink"}`}>
          <p>{msg.text}</p>
          {msg.link && (
            <p className="mt-1 break-all text-ink-soft">
              {t.plan.sendYourself} <span className="font-mono text-[14px]">{msg.link}</span>
            </p>
          )}
        </div>
      )}
    </form>
  );
}
