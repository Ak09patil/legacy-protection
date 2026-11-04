"use client";

import { createContext, useContext } from "react";
import type { Locale } from "./config";
import { MESSAGES, type Messages } from "./messages";

const Ctx = createContext<Locale>("en");

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <Ctx.Provider value={locale}>{children}</Ctx.Provider>;
}

export function useLocale(): Locale {
  return useContext(Ctx);
}

/** Messages for client components. Functions can't cross the server/client line, so each side imports its own copy. */
export function useT(): Messages {
  return MESSAGES[useContext(Ctx)];
}
