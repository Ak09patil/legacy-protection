"use client";

import { useState, useTransition } from "react";
import { useT } from "@/i18n/client";
import { reissueInviteAction } from "../actions";

/** For when email isn't enough: a fresh one-time link the owner can send any way they like. The old link stops working. */
export function CopyInvite({ role, name }: { role: "TRUSTED_CONTACT" | "EXECUTOR"; name: string }) {
  const t = useT();
  const [link, setLink] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="rounded-2xl bg-mist/70 px-4 py-3 text-[17px]">
      {link ? (
        <>
          <p>{t.plan.sendLink(name)}</p>
          <p className="mt-1 break-all font-mono text-[14px] text-ink-soft" data-testid="invite-link">
            {link}
          </p>
          <button
            type="button"
            className="mt-2 min-h-[48px] font-semibold text-green underline underline-offset-4"
            onClick={() => navigator.clipboard?.writeText(link).then(() => setMsg(t.plan.copied))}
          >
            {t.plan.copyLink}
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={pending}
          className="min-h-[48px] text-left font-semibold text-green underline underline-offset-4"
          onClick={() =>
            start(async () => {
              const r = await reissueInviteAction(role);
              if (r.ok) setLink(r.link);
              else setMsg(r.message);
            })
          }
        >
          {t.plan.newLink(name)}
        </button>
      )}
      {msg && (
        <p role="status" className="mt-1 text-ink-soft">
          {msg}
        </p>
      )}
    </div>
  );
}
