import "server-only";
import { cookies, headers } from "next/headers";
import { fromAcceptLanguage, isLocale, LOCALE_COOKIE, type Locale } from "./config";
import { fmtDate, fmtMoney, fmtWhen } from "./format";
import { MESSAGES, type Messages } from "./messages";

/** The reader's language: their own choice first, then their browser's. */
export async function getLocale(): Promise<Locale> {
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;
  return fromAcceptLanguage((await headers()).get("accept-language"));
}

export interface I18n {
  locale: Locale;
  t: Messages;
  money: (minor: number | bigint | string, currency?: string) => string;
  when: (d: Date | string | number, timeZone?: string) => string;
  date: (d: Date | string | number) => string;
}

export function i18nFor(locale: Locale): I18n {
  return {
    locale,
    t: MESSAGES[locale],
    money: (m, c) => fmtMoney(locale, m, c),
    when: (d, z) => fmtWhen(locale, d, z),
    date: (d) => fmtDate(locale, d),
  };
}

export async function getI18n(): Promise<I18n> {
  return i18nFor(await getLocale());
}
