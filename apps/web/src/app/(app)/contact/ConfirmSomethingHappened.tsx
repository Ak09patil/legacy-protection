"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buttonStyles } from "@/components/app/ui";
import { contactConfirmAction } from "../actions";

/**
 * Asks the device for a user-verified passkey gesture (Touch ID, Face ID or
 * the device PIN). Server-side passkey verification is a listed limitation of
 * this demo; the state machine still refuses any confirmation not marked as
 * passkey-verified (INV, THREAT_MODEL T1).
 */
async function passkeyGesture(): Promise<"verified" | "unavailable" | "cancelled"> {
  if (typeof window === "undefined" || !window.PublicKeyCredential) return "unavailable";
  try {
    const ok = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!ok) return "unavailable";
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: "Legacy Protection (demo)" },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "priya@example.com", displayName: "Priya" },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
        timeout: 60_000,
      },
    });
    return cred ? "verified" : "cancelled";
  } catch {
    return "cancelled";
  }
}

export function ConfirmSomethingHappened({ ownerName, waitingDays }: { ownerName: string; waitingDays: number }) {
  const [step, setStep] = useState<"idle" | "explain" | "simulated">("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const send = (verified: boolean) =>
    start(async () => {
      const r = await contactConfirmAction(verified);
      if (!r.ok) setError(r.reason ?? "We couldn’t record that.");
      else router.refresh();
    });

  const confirm = () =>
    start(async () => {
      setError(null);
      const g = await passkeyGesture();
      if (g === "verified") send(true);
      else if (g === "unavailable") setStep("simulated");
      else setError("The passkey check didn’t finish, so nothing has changed.");
    });

  if (step === "idle") {
    return (
      <button type="button" onClick={() => setStep("explain")} className={`${buttonStyles.soft} mt-5`}>
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
        <li>We’ll tell {ownerName} straight away, by app, email and text.</li>
        <li>Nothing happens for {waitingDays} days. Any sign of her stops it.</li>
        <li>You won’t be able to move or receive any of her money.</li>
      </ul>

      {step === "simulated" ? (
        <div className="mt-4 rounded-2xl bg-mist p-4 text-center">
          <p className="text-[15px] text-ink-soft">This device can’t show a passkey prompt, so this demo stands in for it.</p>
          <button type="button" disabled={pending} onClick={() => send(true)} className={`${buttonStyles.primary} mt-3`}>
            Use demo passkey
          </button>
        </div>
      ) : (
        <button type="button" disabled={pending} onClick={confirm} className={`${buttonStyles.primary} mt-4`}>
          {pending ? "Checking your passkey…" : "Confirm with my passkey"}
        </button>
      )}
      <button type="button" onClick={() => setStep("idle")} className={`${buttonStyles.quiet} mt-4 block w-full text-center`}>
        Not now, I’ll keep trying to reach her
      </button>
      {error && (
        <p role="alert" className="mt-3 text-[15px] text-amber-ink">
          {error}
        </p>
      )}
    </div>
  );
}
