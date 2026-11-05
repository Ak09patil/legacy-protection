"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** While PayPal is confirming, check again every 2 seconds (for up to a minute), so the page updates on its own. */
export function RefreshWhileSending() {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const t = setInterval(() => {
      if (++n > 30) clearInterval(t);
      router.refresh();
    }, 2000);
    return () => clearInterval(t);
  }, [router]);
  return null;
}
