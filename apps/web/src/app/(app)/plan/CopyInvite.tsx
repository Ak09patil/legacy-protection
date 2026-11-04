"use client";

import { useState, useTransition } from "react";
import { reissueInviteAction } from "../actions";

/** For when email isn't enough: a fresh one-time link the owner can send any way they like. The old link stops working. */
export function CopyInvite({ role, name }: { role: "TRUSTED_CONTACT" | "EXECUTOR"; name: string }) {
  const [link, setLink] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="rounded-2xl bg-mist/70 px-4 py-3 text-[15px]">
      {link ? (
        <>
          <p>Send this link to {name}. It works once, for 7 days.</p>
          <p className="mt-1 break-all font-mono text-[13px] text-ink-soft" data-testid="invite-link">{link}</p>
          <button type="button" className="mt-2 font-semibold text-green underline underline-offset-4" onClick={() => navigator.clipboard?.writeText(link).then(() => setMsg("Copied."))}>
            Copy link
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={pending}
          className="font-semibold text-green underline underline-offset-4"
          onClick={() =>
            start(async () => {
              const r = await reissueInviteAction(role);
              if (r.ok) setLink(r.link);
              else setMsg(r.message);
            })
          }
        >
          Get a new invite link for {name}
        </button>
      )}
      {msg && <p role="status" className="mt-1 text-ink-soft">{msg}</p>}
    </div>
  );
}
