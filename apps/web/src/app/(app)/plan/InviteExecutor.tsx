"use client";

import { useState, useTransition } from "react";
import { buttonStyles } from "@/components/app/ui";
import { inviteExecutorAction } from "../actions";

const field =
  "mt-1 w-full rounded-2xl border-0 bg-white/90 px-4 py-3 text-[16px] shadow-[inset_0_0_0_1.5px_rgba(16,36,27,0.12)] focus:shadow-[inset_0_0_0_2px_#2E5E45] focus:outline-none";

export function InviteExecutor() {
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
          setMsg(r.ok ? { ok: true, text: `We’ve emailed ${name}.`, link: r.link } : { ok: false, text: r.message });
        });
      }}
    >
      <p className="text-[15px] text-ink-soft">Your executor sees nothing until your plan starts. Then they get a clear record of what happened.</p>
      <label className="block text-[15px] font-semibold">
        Their name
        <input className={field} value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="block text-[15px] font-semibold">
        Their email
        <input className={field} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <button type="submit" disabled={pending} className={buttonStyles.soft}>
        Invite my executor
      </button>
      {msg && (
        <div role="status" className={`text-[15px] ${msg.ok ? "text-green" : "text-amber-ink"}`}>
          <p>{msg.text}</p>
          {msg.link && (
            <p className="mt-1 break-all text-ink-soft">
              You can also send them this link yourself: <span className="font-mono text-[13px]">{msg.link}</span>
            </p>
          )}
        </div>
      )}
    </form>
  );
}
