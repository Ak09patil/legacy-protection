import "server-only";

/**
 * Sends one email. With RESEND_API_KEY set, it goes through Resend. Without
 * it (local development only), the message is printed to the server console
 * so you can complete sign-in flows on your own machine.
 */
export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production" && !process.env.ALLOW_CONSOLE_EMAIL) {
      throw new Error("RESEND_API_KEY is not set");
    }
    console.log(`\n──── email (not sent: no RESEND_API_KEY) ────\nTo: ${to}\nSubject: ${subject}\n\n${text}\n─────────────────────────────────────────────\n`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM ?? "Legacy Protection <onboarding@resend.dev>", to, subject, text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Email provider returned ${res.status}`);
}
