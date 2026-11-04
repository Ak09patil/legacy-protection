"use client";

import { startAuthentication, startRegistration, WebAuthnError } from "@simplewebauthn/browser";
import { useId, useState, useTransition } from "react";
import { buttonStyles } from "@/components/app/ui";
import { beginSignInAction, beginSignUpAction, finishSignInAction, finishSignUpAction } from "./actions";

const field =
  "mt-1.5 w-full rounded-2xl border-0 bg-white/90 px-4 py-3.5 text-[17px] text-ink shadow-[inset_0_0_0_1.5px_rgba(16,36,27,0.12)] focus:shadow-[inset_0_0_0_2px_#2E5E45] focus:outline-none";

function friendly(e: unknown): string {
  if (e instanceof WebAuthnError && e.code === "ERROR_CEREMONY_ABORTED") return "That was cancelled. Nothing has changed.";
  if (e instanceof Error && e.name === "NotAllowedError") return "That was cancelled or timed out. Please try again.";
  if (e instanceof Error && /redirect/i.test(e.message)) throw e; // let Next.js navigate
  return "Something went wrong with the passkey. Please try again.";
}

export function SignUpForm({ inviteToken, defaultName = "", defaultEmail = "" }: { inviteToken?: string; defaultName?: string; defaultEmail?: string }) {
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const nameId = useId();
  const emailId = useId();

  const submit = (e: React.FormEvent) => {
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
        setError(friendly(err));
      }
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor={nameId} className="block text-[16px] font-semibold">
          Your name
        </label>
        <input id={nameId} required autoComplete="name" className={field} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label htmlFor={emailId} className="block text-[16px] font-semibold">
          Your email
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
        {pending ? "Waiting for your passkey…" : "Create my passkey"}
      </button>
      <p className="text-center text-[15px] text-ink-soft">
        Your phone or computer will ask for your fingerprint, face or screen lock. There’s no password to remember or steal.
      </p>
      {error && (
        <p role="alert" className="rounded-2xl bg-[#FCEFD9] px-4 py-3 text-[16px] text-amber-ink">
          {error}
        </p>
      )}
    </form>
  );
}

export function SignInButton() {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const go = () =>
    start(async () => {
      setError(null);
      const begun = await beginSignInAction();
      try {
        const response = await startAuthentication({ optionsJSON: begun.options });
        const done = await finishSignInAction(begun.challengeId, response);
        if (done && !done.ok) setError(done.message);
      } catch (err) {
        setError(friendly(err));
      }
    });
  return (
    <div className="space-y-3">
      <button type="button" onClick={go} disabled={pending} className={buttonStyles.primary}>
        {pending ? "Waiting for your passkey…" : "Sign in with my passkey"}
      </button>
      {error && (
        <p role="alert" className="rounded-2xl bg-[#FCEFD9] px-4 py-3 text-[16px] text-amber-ink">
          {error}
        </p>
      )}
    </div>
  );
}
