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

  const [codeId, setCodeId] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");

  const done = (r: { ok: boolean; message?: string }) => {
    if (!r.ok) setError(r.message ?? "Nothing has changed.");
    else router.refresh();
  };

  const confirm = () =>
    start(async () => {
      setError(null);
      try {
        const begun = await beginContactConfirmAction();
        if (begun.method === "error") return setError(begun.message);
        if (begun.method === "code") {
          setCodeId(begun.codeId);
          setSentTo(begun.email);
          return;
        }
        const response = await startAuthentication({ optionsJSON: begun.options });
        done(await finishContactConfirmAction({ method: "passkey", challengeId: begun.challengeId, response }));
      } catch {
        setError("The check didn’t finish, so nothing has changed.");
      }
    });

  const submitCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!codeId) return;
    start(async () => {
      setError(null);
      done(await finishContactConfirmAction({ method: "code", codeId, code }));
    });
  };

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
      {codeId ? (
        <form onSubmit={submitCode} className="mt-4 space-y-3">
          <label className="block text-[16px] font-semibold">
            Enter the code we sent to {sentTo}
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="mt-1.5 w-full rounded-2xl bg-white px-4 py-3 text-center font-mono text-[1.4rem] tracking-[0.4em] shadow-[inset_0_0_0_1.5px_rgba(16,36,27,0.12)]"
            />
          </label>
          <button type="submit" disabled={pending} className={buttonStyles.primary}>
            Confirm
          </button>
        </form>
      ) : (
        <button type="button" disabled={pending} onClick={confirm} className={`${buttonStyles.primary} mt-4`}>
          {pending ? "Checking it’s you…" : "Confirm it’s me"}
        </button>
      )}
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
