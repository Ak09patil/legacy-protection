"use client";

import { startAuthentication, startRegistration, WebAuthnError } from "@simplewebauthn/browser";
import { useId, useState, useTransition } from "react";
import { buttonStyles } from "@/components/app/ui";
import { useT } from "@/i18n/client";
import type { Messages } from "@/i18n/messages";
import {
  beginSignInAction,
  beginSignInWithCodeAction,
  beginSignUpAction,
  beginSignUpWithCodeAction,
  finishSignInAction,
  finishSignInWithCodeAction,
  finishSignUpAction,
  finishSignUpWithCodeAction,
} from "./actions";

const field =
  "mt-1.5 w-full min-h-[56px] rounded-2xl border-0 bg-white/90 px-4 py-3.5 text-[18px] text-ink shadow-[inset_0_0_0_1.5px_rgba(16,36,27,0.12)] focus:shadow-[inset_0_0_0_2px_#2E5E45] focus:outline-none";

function friendly(e: unknown, t: Messages): string {
  if (e instanceof Error && /NEXT_REDIRECT/.test(e.message)) throw e; // let Next.js navigate
  if (e instanceof WebAuthnError && e.code === "ERROR_CEREMONY_ABORTED") return t.auth.errCancelled;
  return t.auth.errPasskeyUnavailable;
}

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-2xl bg-[#FCEFD9] px-4 py-3 text-[17px] text-amber-ink">
      {children}
    </p>
  );
}

/** Six-digit code entry, shared by sign-up and sign-in. */
function CodeEntry({ email, onSubmit, pending }: { email: string; onSubmit: (code: string) => void; pending: boolean }) {
  const t = useT();
  const [code, setCode] = useState("");
  const id = useId();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(code);
      }}
    >
      <p className="text-[18px] leading-[1.55]">{t.auth.codeSent(email)}</p>
      <div>
        <label htmlFor={id} className="block text-[18px] font-semibold">
          {t.auth.yourCode}
        </label>
        <input
          id={id}
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          className={`${field} text-center font-mono text-[1.6rem] tracking-[0.4em]`}
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </div>
      <button type="submit" disabled={pending} className={buttonStyles.primary}>
        {pending ? t.auth.checking : t.common.continue}
      </button>
    </form>
  );
}

export function SignUpForm({ inviteToken, defaultName = "", defaultEmail = "" }: { inviteToken?: string; defaultName?: string; defaultEmail?: string }) {
  const t = useT();
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [error, setError] = useState<string | null>(null);
  const [codeId, setCodeId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const nameId = useId();
  const emailId = useId();

  const withPasskey = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const begun = await beginSignUpAction({ name, email, inviteToken });
      if (!begun.ok) return setError(begun.message);
      try {
        const response = await startRegistration({ optionsJSON: begun.value.options });
        const done = await finishSignUpAction(begun.value.challengeId, response);
        if (done && !done.ok) setError(done.message);
      } catch (err) {
        setError(friendly(err, t));
      }
    });
  };

  const withCode = () =>
    start(async () => {
      setError(null);
      const r = await beginSignUpWithCodeAction({ name, email, inviteToken });
      if (!r.ok) return setError(r.message);
      setCodeId(r.value.codeId);
    });

  if (codeId) {
    return (
      <div className="space-y-4">
        <CodeEntry
          email={email}
          pending={pending}
          onSubmit={(code) =>
            start(async () => {
              setError(null);
              try {
                const r = await finishSignUpWithCodeAction(codeId, code);
                if (r && !r.ok) setError(r.message);
              } catch (err) {
                setError(friendly(err, t));
              }
            })
          }
        />
        {error && <Alert>{error}</Alert>}
      </div>
    );
  }

  return (
    <form onSubmit={withPasskey} className="space-y-4">
      <div>
        <label htmlFor={nameId} className="block text-[18px] font-semibold">
          {t.auth.yourName}
        </label>
        <input id={nameId} required autoComplete="name" className={field} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label htmlFor={emailId} className="block text-[18px] font-semibold">
          {t.auth.yourEmail}
        </label>
        <input
          id={emailId}
          required
          type="email"
          autoComplete="email webauthn"
          className={field}
          value={email}
          readOnly={!!defaultEmail}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <button type="submit" disabled={pending} className={buttonStyles.primary}>
        {pending ? t.auth.waiting : t.auth.createPasskey}
      </button>
      <p className="text-center text-[17px] leading-[1.55] text-ink-soft">{t.auth.passkeyHelp}</p>
      <button
        type="button"
        disabled={pending || !name || !email}
        onClick={withCode}
        className={`${buttonStyles.quiet} block w-full text-center disabled:opacity-50`}
      >
        {t.auth.emailCodeInstead}
      </button>
      {error && <Alert>{error}</Alert>}
    </form>
  );
}

export function SignInButton() {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"passkey" | "email" | "code">("passkey");
  const [email, setEmail] = useState("");
  const [codeId, setCodeId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const emailId = useId();

  const go = () =>
    start(async () => {
      setError(null);
      const begun = await beginSignInAction();
      try {
        const response = await startAuthentication({ optionsJSON: begun.options });
        const done = await finishSignInAction(begun.challengeId, response);
        if (done && !done.ok) setError(done.message);
      } catch (err) {
        setError(friendly(err, t));
      }
    });

  if (mode === "code" && codeId) {
    return (
      <div className="space-y-4">
        <CodeEntry
          email={email}
          pending={pending}
          onSubmit={(code) =>
            start(async () => {
              setError(null);
              try {
                const r = await finishSignInWithCodeAction(codeId, code);
                if (r && !r.ok) setError(r.message);
              } catch (err) {
                setError(friendly(err, t));
              }
            })
          }
        />
        {error && <Alert>{error}</Alert>}
      </div>
    );
  }

  if (mode === "email") {
    return (
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setError(null);
            const r = await beginSignInWithCodeAction(email);
            if (!r.ok) return setError(r.message);
            setCodeId(r.value.codeId);
            setMode("code");
          });
        }}
      >
        <div>
          <label htmlFor={emailId} className="block text-[18px] font-semibold">
            {t.auth.yourEmail}
          </label>
          <input id={emailId} required type="email" autoComplete="email" className={field} value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <button type="submit" disabled={pending} className={buttonStyles.primary}>
          {t.auth.emailMeCode}
        </button>
        <button type="button" onClick={() => setMode("passkey")} className={`${buttonStyles.quiet} block w-full text-center`}>
          {t.auth.usePasskeyInstead}
        </button>
        {error && <Alert>{error}</Alert>}
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <button type="button" onClick={go} disabled={pending} className={buttonStyles.primary}>
        {pending ? t.auth.waiting : t.auth.signInPasskey}
      </button>
      <button type="button" onClick={() => setMode("email")} className={`${buttonStyles.quiet} block w-full text-center`}>
        {t.auth.emailCodeInstead}
      </button>
      {error && <Alert>{error}</Alert>}
    </div>
  );
}
