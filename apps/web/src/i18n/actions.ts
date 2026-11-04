"use server";

import { cookies } from "next/headers";
import { currentUser } from "@/server/auth";
import { db } from "@/server/db";
import { isLocale, LOCALE_COOKIE } from "./config";

/** Saves the reader's language on this device, and on their account so emails match. */
export async function setLanguageAction(formData: FormData): Promise<void> {
  const locale = formData.get("locale");
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 400 });
  const user = await currentUser();
  if (user) await db().query(`UPDATE users SET locale = $1 WHERE id = $2`, [locale, user.id]);
}
