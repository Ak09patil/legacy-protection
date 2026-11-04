"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buttonStyles } from "@/components/app/ui";
import { useT } from "@/i18n/client";
import { beginContactConfirmAction, finishContactConfirmAction } from "../actions";

/**
 * "Something has happened." Needs a fresh passkey check, verified on the
 * server for this exact action, before the plan's state can move.
 */
export function ConfirmSomethingHappened({ ownerName, waitingDays }: { ownerName: string; waitingDays: number }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const [codeId, setCodeId] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");

  const done = (r: { ok: boolean; message?: string }) => {
    if (!r.ok) setError(r.message ?? t.contact.checkFailed);
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
        setError(t.contact.checkFailed);
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
        {t.contact.somethingHappened}
      </button>
    );
  }

  return (
    <div className="mt-5 rounded-[1.5rem] bg-white/90 p-5" role="group" aria-labelledby="confirm-h">
      <p id="confirm-h" className="text-[18px] font-semibold">
        {t.contact.beforeConfirm}
      </p>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[17px] leading-[1.5] text-ink-soft">
        <li>{t.contact.beforeA(ownerName)}</li>
        <li>{t.contact.beforeB(waitingDays)}</li>
        <li>{t.contact.beforeC}</li>
      </ul>
      {codeId ? (
        <form onSubmit={submitCode} className="mt-4 space-y-3">
          <label className="block text-[18px] font-semibold">
            {t.contact.enterCode(sentTo)}
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="mt-1.5 min-h-[56px] w-full rounded-2xl bg-white px-4 py-3 text-center font-mono text-[1.4rem] tracking-[0.4em] shadow-[inset_0_0_0_1.5px_rgba(16,36,27,0.12)]"
            />
          </label>
          <button type="submit" disabled={pending} className={buttonStyles.primary}>
            {t.contact.confirmCode}
          </button>
        </form>
      ) : (
        <button type="button" disabled={pending} onClick={confirm} className={`${buttonStyles.primary} mt-4`}>
          {pending ? t.contact.checkingYou : t.contact.confirmMe}
        </button>
      )}
      <button type="button" onClick={() => setOpen(false)} className={`${buttonStyles.quiet} mt-4 block w-full text-center`}>
        {t.contact.notNow}
      </button>
      {error && (
        <p role="alert" className="mt-3 text-[17px] text-amber-ink">
          {error}
        </p>
      )}
    </div>
  );
}
