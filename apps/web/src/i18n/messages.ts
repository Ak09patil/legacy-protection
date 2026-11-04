import type { Locale } from "./config";
import { de } from "./de";
import { en, type Messages } from "./en";
import { es } from "./es";

export const MESSAGES: Record<Locale, Messages> = { en, de, es };
export type { Messages };
