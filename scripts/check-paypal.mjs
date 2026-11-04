// Checks your PayPal sandbox credentials without ever printing them.
// Run: pnpm check:paypal
const id = process.env.PAYPAL_CLIENT_ID?.trim();
const secret = process.env.PAYPAL_CLIENT_SECRET?.trim();
if (!id || !secret) {
  console.error("✗ PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET is missing from .env");
  process.exit(1);
}
const res = await fetch("https://api-m.sandbox.paypal.com/v1/oauth2/token", {
  method: "POST",
  headers: {
    Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: "grant_type=client_credentials",
});
if (!res.ok) {
  console.error(`✗ PayPal sandbox said ${res.status}. Check you copied the SANDBOX keys (not Live), with no extra spaces.`);
  process.exit(1);
}
const body = await res.json();
const scopes = String(body.scope ?? "");
const need = {
  Invoicing: "https://uri.paypal.com/services/invoicing",
  Subscriptions: "https://uri.paypal.com/services/subscriptions",
  Payouts: "https://uri.paypal.com/services/payments/payouts",
  "Transaction search": "https://uri.paypal.com/services/reporting/search/read",
};
console.log(`✓ Sandbox credentials work (app ${body.app_id ?? "unknown"}).`);
for (const [name, scope] of Object.entries(need)) {
  console.log(`  ${scopes.includes(scope) ? "✓" : "✗"} ${name}${scopes.includes(scope) ? "" : " — turn this on in the app's Features settings"}`);
}
