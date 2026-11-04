import { INTL_LOCALE, type Locale } from "./config";

/** Money in the reader's own conventions: $1,234.50 / 1.234,50 $ / 1234,50 US$. */
export function fmtMoney(locale: Locale, minor: number | bigint | string, currency = "USD"): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale], { style: "currency", currency }).format(Number(minor) / 100);
}

/** A day and time someone can read aloud: "Friday, 7 November, 10:00". */
export function fmtWhen(locale: Locale, d: Date | string | number, timeZone?: string): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(d));
}

export function fmtDate(locale: Locale, d: Date | string | number): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { day: "numeric", month: "long", year: "numeric" }).format(new Date(d));
}
