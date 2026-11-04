"use client";

import { useState, useTransition } from "react";
import { checkInAction } from "../actions";
import { buttonStyles } from "@/components/app/ui";

export function CheckInButton({ label = "I’m here", hint = "One tap lets us know you’re well." }: { label?: string; hint?: string }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  return (
    <div className="text-center">
      <button
        type="button"
        className={buttonStyles.primary}
        disabled={pending}
        onClick={() =>
          start(async () => {
            await checkInAction();
            setDone(true);
          })
        }
      >
        {pending ? "Checking in…" : label}
      </button>
      <p role="status" className="mt-3 min-h-[1.5em] text-[15px] text-ink-soft">
        {done ? "Thanks, you’re checked in. See you next week." : hint}
      </p>
    </div>
  );
}
