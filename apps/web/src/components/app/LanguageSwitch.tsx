"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LOCALE_NAMES, LOCALES } from "@/i18n/config";
import { setLanguageAction } from "@/i18n/actions";
import { useLocale, useT } from "@/i18n/client";

/**
 * Each language is named in itself ("Deutsch", not "German"), so someone who
 * can't read the current page can still find their own. Plain buttons, not a
 * dropdown: one tap, big targets, nothing hidden.
 */
export function LanguageSwitch() {
  const current = useLocale();
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div role="group" aria-label={`${t.common.language} / Language`} className="flex gap-1 rounded-full bg-white/60 p-1 backdrop-blur-xl">
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          disabled={pending}
          aria-pressed={l === current}
          onClick={() =>
            start(async () => {
              const f = new FormData();
              f.set("locale", l);
              await setLanguageAction(f);
              router.refresh();
            })
          }
          className={`min-h-[44px] rounded-full px-3 text-[15px] font-semibold ${l === current ? "bg-ink text-mist" : "text-ink-soft hover:bg-white/80 hover:text-ink"}`}
        >
          {LOCALE_NAMES[l]}
        </button>
      ))}
    </div>
  );
}
