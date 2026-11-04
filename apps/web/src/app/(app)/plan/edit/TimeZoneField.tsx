"use client";

import { useId, useMemo, useState } from "react";
import { INTL_LOCALE, type Locale } from "@/i18n/config";
import { useLocale, useT } from "@/i18n/client";

/** The zones most of our readers live in, per language, first. Every IANA zone is one tap away. */
const COMMON: Record<Locale, readonly string[]> = {
  en: ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "Europe/London", "Australia/Sydney"],
  de: ["Europe/Berlin", "Europe/Vienna", "Europe/Zurich", "Europe/London", "America/New_York"],
  es: ["Europe/Madrid", "Atlantic/Canary", "America/Mexico_City", "America/Bogota", "America/Lima", "America/Santiago", "America/Argentina/Buenos_Aires", "America/New_York"],
};

const city = (tz: string) => (tz.split("/").pop() ?? tz).replaceAll("_", " ");

function label(tz: string, locale: Locale): string {
  try {
    const name = new Intl.DateTimeFormat(INTL_LOCALE[locale], { timeZone: tz, timeZoneName: "longGeneric" }).formatToParts(0).find((p) => p.type === "timeZoneName")?.value;
    return name ? `${name} (${city(tz)})` : city(tz);
  } catch {
    return city(tz);
  }
}

export function TimeZoneField({ value, onChange, className }: { value: string; onChange: (tz: string) => void; className: string }) {
  const id = useId();
  const t = useT();
  const locale = useLocale();
  const [showAll, setShowAll] = useState(false);
  const all = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
    } catch {
      return [...COMMON[locale]];
    }
  }, [locale]);
  const common = COMMON[locale];
  const zones = showAll ? all : [...(common.includes(value) ? [] : [value]), ...common];

  return (
    <div>
      <label htmlFor={id} className="block text-[18px] font-semibold">
        {t.editor.timeZone}
      </label>
      <p className="text-[16px] text-ink-soft">{t.editor.timeZoneHelp}</p>
      <select id={id} className={className} value={value} onChange={(e) => onChange(e.target.value)}>
        {zones.map((z) => (
          <option key={z} value={z}>
            {showAll ? z.replaceAll("_", " ") : label(z, locale)}
          </option>
        ))}
      </select>
      {!showAll && (
        <button type="button" className="mt-2 min-h-[48px] text-[17px] font-semibold text-green underline decoration-mint decoration-2 underline-offset-[5px]" onClick={() => setShowAll(true)}>
          {t.editor.timeZoneMissing}
        </button>
      )}
    </div>
  );
}
