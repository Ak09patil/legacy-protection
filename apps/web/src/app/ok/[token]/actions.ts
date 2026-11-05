"use server";

import { redirect } from "next/navigation";
import { pokeTimeline } from "@/server/timeline";
import { checkInWithLink, openCheckInLink } from "@/server/plans";

export async function okViaLinkAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "").slice(0, 200);
  const link = await openCheckInLink(token);
  if (link.status !== "OK") redirect(`/ok/${encodeURIComponent(token)}`);
  await checkInWithLink(token);
  await pokeTimeline(link.planId);
  redirect(`/ok/${encodeURIComponent(token)}?done=1`);
}
