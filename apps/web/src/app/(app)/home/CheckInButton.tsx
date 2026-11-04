"use client";

import { useState, useTransition } from "react";
import { checkInAction } from "../actions";
import { buttonStyles } from "@/components/app/ui";
import { useT } from "@/i18n/client";

export function CheckInButton({ label, hint }: { label?: string; hint?: string }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  return (
    <div className="text-center">
      <button
        type="button"
        className={`${buttonStyles.primary} min-h-[72px] text-[22px]`}
        disabled={pending}
        onClick={() =>
          start(async () => {
            await checkInAction();
            setDone(true);
          })
        }
      >
        {pending ? t.home.checkingIn : (label ?? t.home.checkInButton)}
      </button>
      <p role="status" className="mt-3 min-h-[1.5em] text-[17px] text-ink-soft">
        {done ? t.home.checkedIn : (hint ?? t.home.checkInHint)}
      </p>
    </div>
  );
}
