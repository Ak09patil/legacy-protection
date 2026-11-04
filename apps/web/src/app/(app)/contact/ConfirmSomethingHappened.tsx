"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buttonStyles } from "@/components/app/ui";
import { beginContactConfirmAction, finishContactConfirmAction } from "../actions";

/**
 * "Something has happened." Needs a fresh passkey check, verified on the
 * server for this exact action, before the plan's state can move.
 */
export function ConfirmSomethingHappened({ ownerName, waitingDays }: { ownerName: string; waitingDays: number }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const confirm = () =>
    start(async () => {
      setError(null);
      try {
        const begun = await beginContactConfirmAction();
        const response = await startAuthentication({ optionsJSON: begun.options });
        const r = await finishContactConfirmAction(begun.challengeId, response);
        if (!r.ok) setError(r.message ?? "Nothing has changed.");
        else router.refresh();
      } catch {
        setError("The passkey check didn’t finish, so nothing has changed.");
      }
    });

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${buttonStyles.soft} mt-5`}>
        I know something has happened
      </button>
    );
  }

  return (
    <div className="mt-5 rounded-[1.5rem] bg-white/90 p-5" role="group" aria-labelledby="confirm-h">
      <p id="confirm-h" className="text-[17px] font-semibold">
        Before you confirm
      </p>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[16px] leading-snug text-ink-soft">
        <li>We’ll tell {ownerName} straight away, by app and email.</li>
        <li>Nothing happens for at least {waitingDays} days. Any sign of them stops it.</li>
        <li>You won’t be able to move or receive any of their money.</li>
      </ul>
      <button type="button" disabled={pending} onClick={confirm} className={`${buttonStyles.primary} mt-4`}>
        {pending ? "Checking your passkey…" : "Confirm with my passkey"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className={`${buttonStyles.quiet} mt-4 block w-full text-center`}>
        Not now, I’ll keep trying to reach them
      </button>
      {error && (
        <p role="alert" className="mt-3 text-[15px] text-amber-ink">
          {error}
        </p>
      )}
    </div>
  );
}
