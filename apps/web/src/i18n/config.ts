export const LOCALES = ["en", "de", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "lp_lang";

/** Each language named in itself, so anyone can find their own. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", de: "Deutsch", es: "Español" };

/** For number, money and date formatting. */
export const INTL_LOCALE: Record<Locale, string> = { en: "en-US", de: "de-DE", es: "es-ES" };

export function isLocale(x: unknown): x is Locale {
  return typeof x === "string" && (LOCALES as readonly string[]).includes(x);
}

/** Picks the best supported language from an Accept-Language header. */
export function fromAcceptLanguage(header: string | null | undefined): Locale {
  for (const part of (header ?? "").split(",")) {
    const tag = part.split(";")[0]?.trim().toLowerCase().slice(0, 2);
    if (isLocale(tag)) return tag;
  }
  return DEFAULT_LOCALE;
}
