// Live PayPal sandbox check, run on your own machine with your sandbox keys.
// Never prints credentials. Run from the repo root:  pnpm paypal:smoke
//
// What it proves, against the real PayPal sandbox:
//   1. PayPal's own Agent Toolkit can read the account (transactions, invoices).
//   2. The policy gate refuses tools and arguments the plan doesn't allow,
//      before any call reaches PayPal.
//   3. An allowed step really runs: an invoice is cancelled and a care
//      payment is paid, each with a PayPal-Request-Id derived from the plan.
//   4. Repeating the same payment does not pay twice.

import { randomUUID } from "node:crypto";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/openai";
import { money } from "@lp/core";
import { authorize, type Authority, type PlannedStep } from "@lp/guard";
import { planExecution, PlanDocumentSchema } from "@lp/policy";
import { cancelInvoice, payCaregiver, PayPalClient, PayPalError } from "@lp/paypal";

const id = process.env.PAYPAL_CLIENT_ID?.trim();
const secret = process.env.PAYPAL_CLIENT_SECRET?.trim();
const maria = process.env.PAYPAL_SANDBOX_MARIA_EMAIL?.trim();
if (!id || !secret) {
  console.error("✗ PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set in .env");
  process.exit(1);
}
if (!maria) {
  console.error("✗ Set PAYPAL_SANDBOX_MARIA_EMAIL in .env to your sandbox Personal account's email (Testing Tools → Sandbox Accounts).");
  process.exit(1);
}

const ok = (s: string) => console.log(`  ✓ ${s}`);
const no = (s: string) => console.log(`  ✗ ${s}`);
const why = (e: unknown) => (e instanceof PayPalError ? `${e.status} ${e.issue ?? ""} (debug id ${e.debugId ?? "none"})` : e instanceof Error ? e.message : String(e));
let failures = 0;

const client = new PayPalClient({ clientId: id, clientSecret: secret });
const toolkit = new PayPalAgentToolkit({
  clientId: id,
  clientSecret: secret,
  configuration: { actions: { transactions: { list: true }, invoices: { list: true } }, context: { sandbox: true } },
});
const callTool = async (name: string, args: unknown) => {
  const r = await toolkit.handleToolCall({ id: randomUUID(), type: "function", function: { name, arguments: JSON.stringify(args) } });
  const text = typeof r.content === "string" ? r.content : JSON.stringify(r.content);
  // The toolkit reports failures inside the tool message rather than throwing.
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* plain text answer */
  }
  const err = (parsed as { error?: { message?: string } } | null)?.error;
  if (err) throw new Error(err.message ?? "toolkit error");
  return parsed;
};
const summarise = (x: unknown) => {
  const o = x as { transaction_details?: unknown[]; items?: unknown[]; total_items?: number } | null;
  if (o && Array.isArray(o.transaction_details)) return `${o.transaction_details.length} transaction(s) in the last 31 days`;
  if (o && Array.isArray(o.items)) return `${o.items.length} invoice(s) on the first page`;
  return "answered";
};

console.log("\n1. PayPal Agent Toolkit, reading the account");
try {
  ok(`list_transactions: ${summarise(await callTool("list_transactions", {}))}`);
} catch (e) {
  no(`list_transactions: ${why(e)}`);
  failures++;
}
try {
  ok(`list_invoices: ${summarise(await callTool("list_invoices", { page: 1, page_size: 5 }))}`);
} catch (e) {
  no(`list_invoices: ${why(e)}`);
  failures++;
}

console.log("\n2. Setting up: a sent invoice the plan will cancel");
let invoiceId = "";
try {
  const inv = await client.request<{ id?: string; href?: string }>({
    method: "POST",
    path: "/v2/invoicing/invoices",
    idempotencyKey: `lp-smoke-${randomUUID()}`,
    body: {
      detail: { currency_code: "USD", note: "Legacy Protection sandbox check. Safe to ignore." },
      primary_recipients: [{ billing_info: { email_address: maria } }],
      items: [{ name: "Quilting class (sandbox check)", quantity: "1", unit_amount: { currency_code: "USD", value: "80.00" } }],
    },
  });
  const draftId = inv.id ?? inv.href?.split("/").pop() ?? "";
  await client.request({ method: "POST", path: `/v2/invoicing/invoices/${draftId}/send`, idempotencyKey: `lp-smoke-${randomUUID()}`, body: { send_to_invoicer: false } });
  invoiceId = draftId; // only a sent invoice can be cancelled
  ok(`invoice ${invoiceId} created and sent`);
} catch (e) {
  no(`could not create and send an invoice: ${why(e)}`);
  if (e instanceof PayPalError && e.issue === "INR_FOREIGN_CURRENCY_BLOCKED") console.log("    This sandbox account is registered in India, which can't invoice in USD. Use a US sandbox business account.");
  failures++;
}

// The plan the gate enforces: Maria $1.00 a week, and cancel that invoice.
const plan = PlanDocumentSchema.parse({
  schemaVersion: 1,
  trustedContact: { name: "Priya", email: "priya@example.com" },
  checkin: { timeZone: "America/New_York", intervalDays: 7, localHour: 10, localMinute: 0 },
  waitingPeriodHours: 72,
  obligations: [
    {
      id: "maria-care",
      kind: "HOUSEHOLD_EMPLOYEE",
      payeeName: "Maria",
      payeeEmail: maria.toLowerCase(),
      description: "home care",
      amountPerPaymentMinor: 100,
      maxPerMonthMinor: 500,
      currency: "USD",
      cadence: "WEEKLY",
      continueForDaysAfterActivation: 14,
    },
  ],
  onActivation: { cancelSubscriptions: true, cancelOpenInvoices: true, holdBalanceForEstate: true },
  contentVisibleTo: [],
});
const now = Date.now();
const planVersionId = `smoke-${now}`;
const steps: PlannedStep[] = planExecution(plan, { activeSubscriptionIds: [], openInvoiceIds: invoiceId ? [invoiceId] : [] }, now).map((step) => ({ step, done: false }));
const auth: Authority = { mode: "executor", phase: "EXECUTING", planVersionId, steps, now };

console.log("\n3. The gate refuses what the plan doesn't allow (no call reaches PayPal)");
for (const [label, call] of [
  ["a refund tool", { name: "create_refund", args: { capture_id: "X" } }],
  ["a payout with the model's own amount and payee", { name: "pay_planned_obligation", args: { step_id: "pay:maria-care:0", amount: "500", receiver: "someone@example.com" } }],
  ["cancelling an invoice that isn't in the plan", { name: "cancel_sent_invoice", args: { invoice_id: "INV2-NOT-IN-PLAN" } }],
  ["paying next week's care payment early", { name: "pay_planned_obligation", args: { step_id: "pay:maria-care:1" } }],
] as const) {
  const v = authorize(call, auth);
  if (v.allow) {
    no(`gate allowed ${label}`);
    failures++;
  } else ok(`refused ${label} (${v.code})`);
}
const advisor = authorize({ name: "cancel_sent_invoice", args: { invoice_id: invoiceId || "X" } }, { ...auth, mode: "advisor" });
if (advisor.allow) {
  no("the read-only advisor was allowed to cancel an invoice");
  failures++;
} else ok(`refused a change from the read-only advisor (${advisor.code})`);

console.log("\n4. Allowed steps really run on PayPal");
if (invoiceId) {
  const v = authorize({ name: "cancel_sent_invoice", args: { invoice_id: invoiceId } }, auth);
  if (v.allow && v.kind === "write" && v.step.type === "CANCEL_INVOICE") {
    try {
      await cancelInvoice(client, { planVersionId, stepId: v.step.id, invoiceId, note: "Cancelled under the owner's Legacy Protection plan (sandbox check)." });
      const after = await client.request<{ status?: string }>({ method: "GET", path: `/v2/invoicing/invoices/${invoiceId}` });
      ok(`invoice cancelled through the gate; PayPal now says ${after.status ?? "unknown"}`);
    } catch (e) {
      no(`cancel invoice: ${why(e)}`);
      failures++;
    }
  }
}

const pay = authorize({ name: "pay_planned_obligation", args: { step_id: "pay:maria-care:0" } }, auth);
if (pay.allow && pay.kind === "write" && pay.step.type === "PAY_OBLIGATION") {
  const step = pay.step;
  const send = () =>
    payCaregiver(client, {
      planVersionId,
      stepId: step.id,
      receiverEmail: step.payeeEmail,
      amount: money(BigInt(step.amountMinor), step.currency),
      note: "Care payment from a Legacy Protection plan (sandbox check).",
    });
  try {
    const first = await send();
    ok(`paid ${step.payeeEmail} $${(step.amountMinor / 100).toFixed(2)}: payout batch ${first.batch_header.payout_batch_id} (${first.batch_header.batch_status})`);
    try {
      const second = await send();
      if (second.batch_header.payout_batch_id === first.batch_header.payout_batch_id) ok("repeating the same step returned the same batch: paid once, not twice");
      else {
        no(`repeating the step created a second batch ${second.batch_header.payout_batch_id}`);
        failures++;
      }
    } catch (e) {
      if (e instanceof PayPalError && (e.status === 400 || e.status === 409 || e.status === 422)) ok(`repeating the same step was refused by PayPal (${e.issue ?? e.status}): paid once, not twice`);
      else {
        no(`repeat payout: ${why(e)}`);
        failures++;
      }
    }
  } catch (e) {
    no(`payout to Maria: ${why(e)}`);
    if (e instanceof PayPalError && e.issue === "PAYOUT_NOT_AVAILABLE") console.log("    Payouts aren't available on this sandbox account's country. Use a US sandbox business account.");
    failures++;
  }
}

console.log(failures ? `\n${failures} check(s) failed. Send this output over.\n` : "\nAll checks passed against the live PayPal sandbox.\n");
process.exit(failures ? 1 : 0);
