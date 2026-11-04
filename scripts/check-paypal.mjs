// Checks your PayPal sandbox credentials and app features without ever printing secrets.
// Run: pnpm check:paypal
//
// Feature check: rather than trusting the token's scope list (PayPal keeps
// handing out the same token for hours after you change features), this makes
// one harmless read call per feature and reports whether PayPal allowed it.
const id = process.env.PAYPAL_CLIENT_ID?.trim();
const secret = process.env.PAYPAL_CLIENT_SECRET?.trim();
if (!id || !secret) {
  console.error("✗ PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET is missing from .env");
  process.exit(1);
}
const BASE = "https://api-m.sandbox.paypal.com";
const tok = await fetch(`${BASE}/v1/oauth2/token`, {
  method: "POST",
  headers: {
    Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: "grant_type=client_credentials",
});
if (!tok.ok) {
  console.error(`✗ PayPal sandbox said ${tok.status}. Check you copied the SANDBOX keys (not Live), with no extra spaces.`);
  process.exit(1);
}
const { access_token } = await tok.json();
console.log("✓ Sandbox credentials work.");

const end = new Date();
const start = new Date(end.getTime() - 7 * 86_400_000);
const probes = [
  ["Invoicing", "/v2/invoicing/invoices?page=1&page_size=1"],
  ["Subscriptions", "/v1/billing/plans?page_size=1"],
  ["Payouts", "/v1/payments/payouts/LPCHECK000000"], // a batch that doesn't exist: 404 means allowed, 403 means not enabled
  ["Transaction search", `/v1/reporting/transactions?start_date=${start.toISOString().slice(0, 19)}Z&end_date=${end.toISOString().slice(0, 19)}Z&page_size=1`],
];
let allOk = true;
for (const [name, path] of probes) {
  const r = await fetch(BASE + path, { headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" } });
  const body = await r.json().catch(() => ({}));
  const denied = r.status === 401 || r.status === 403 || body.name === "NOT_AUTHORIZED" || body.name === "PERMISSION_DENIED";
  if (denied) allOk = false;
  console.log(`  ${denied ? "✗" : "✓"} ${name} (${r.status}${body.name ? " " + body.name : ""})`);
}
if (!allOk) {
  console.log("\nIf a feature is ticked on developer.paypal.com but shows ✗ here, PayPal can take a few hours to switch it on in sandbox. Run this again later.");
}
