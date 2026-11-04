import "server-only";

/**
 * The state behind the product screens: one owner (Eleanor), her confirmed
 * plan, her trusted contact (Priya), and her recent payments.
 *
 * Every decision here comes from the real engine: hard rules from
 * @lp/policy, combined with the risk model's recorded signal through the same
 * fail-closed `decide` the executor uses. Plans are validated by the real
 * plan schema, and check-in times come from the real scheduler.
 *
 * Storage is in-process for now (one shared world per server). It moves to
 * Postgres with the hash-chained audit log in the persistence step.
 */

import { DEFAULT_POLICY, nextDue } from "@lp/core";
import {
  decide,
  evaluateRules,
  PlanDocumentSchema,
  RULES_VERSION,
  summarisePlan,
  type Decision,
  type ModelSignal,
  type PaymentFacts,
  type PlanDocument,
} from "@lp/policy";

export type PaymentStatus =
  | "SENT"
  | "PAUSED"
  | "STOPPED_BY_OWNER"
  | "WAITING_FOR_CONTACT"
  | "RELEASE_SCHEDULED"
  | "RELEASED";

export interface Payment {
  id: string;
  payeeName: string;
  payeeIsNew: boolean;
  amountMinor: number;
  currency: "USD";
  note: string;
  method: "p2p" | "gift_card" | "crypto" | "bank_transfer";
  createdAt: number;
  decision: Decision;
  status: PaymentStatus;
  releaseAt?: number;
  history: Array<{ at: number; text: string }>;
}

export interface ContactAlert {
  id: string;
  at: number;
  text: string;
  paymentId?: string;
}

interface World {
  owner: { name: string; firstName: string };
  plan: PlanDocument;
  planVersion: number;
  planConfirmedAt: number;
  lastCheckinAt: number;
  payments: Payment[];
  contactAlerts: ContactAlert[];
}

const DAY = 86_400_000;
const POLICY_VERSION = `policy-1.0.0+${RULES_VERSION}`;

/** A risk-model signal recorded from the Python service (services/risk) for the seeded scam payment. */
const RECORDED_SCAM_SIGNAL: ModelSignal = {
  level: "HOLD",
  networkOnly: false,
  modelVersion: "risk-lgbm-a2ea68bf996a",
  reasons: [
    { code: "RISKY_METHOD", text: "This payment method is one scammers often ask for.", source: "MODEL" },
    { code: "UNUSUAL_AMOUNT", text: "This payment is much larger than your usual payments.", source: "MODEL" },
  ],
};

const PASS_SIGNAL: ModelSignal = { level: "PASS", reasons: [], networkOnly: false, modelVersion: "risk-lgbm-a2ea68bf996a" };

function judge(facts: PaymentFacts, signal: ModelSignal, planVersion: number): Decision {
  return decide(evaluateRules(facts), { status: "OK", signals: [signal] }, {
    payeeIsRegisteredCaregiver: facts.payeeIsRegisteredCaregiver,
    policyVersion: POLICY_VERSION,
    planVersionId: `eleanor-v${planVersion}`,
  });
}

const INITIAL_PLAN: PlanDocument = PlanDocumentSchema.parse({
  schemaVersion: 1,
  trustedContact: { name: "Priya", email: "priya@example.com" },
  checkin: { timeZone: "America/New_York", intervalDays: 7, localHour: 10, localMinute: 0 },
  waitingPeriodHours: 72,
  obligations: [
    {
      id: "maria-care",
      kind: "HOUSEHOLD_EMPLOYEE",
      payeeName: "Maria",
      payeeEmail: "maria@example.com",
      description: "home care",
      amountPerPaymentMinor: 32000,
      maxPerMonthMinor: 140000,
      currency: "USD",
      cadence: "WEEKLY",
      continueForDaysAfterActivation: 60,
    },
  ],
  onActivation: { cancelSubscriptions: true, cancelOpenInvoices: true, holdBalanceForEstate: true },
  contentVisibleTo: [],
});

function seed(now: number): World {
  const p = (
    id: string,
    payeeName: string,
    amountMinor: number,
    daysAgo: number,
    facts: Partial<PaymentFacts>,
    extra: Partial<Payment> = {},
    signal: ModelSignal = PASS_SIGNAL,
  ): Payment => {
    const f: PaymentFacts = {
      payeeIsNew: false,
      payeeIsRegisteredCaregiver: false,
      amountRatioToTypical: 1,
      textLabels: [],
      withinRegisteredObligationCap: true,
      ...facts,
    };
    const decision = judge(f, signal, 1);
    const createdAt = now - daysAgo * DAY;
    return {
      id,
      payeeName,
      payeeIsNew: f.payeeIsNew,
      amountMinor,
      currency: "USD",
      note: "",
      method: "p2p",
      createdAt,
      decision,
      status: decision.level === "PASS" ? "SENT" : "PAUSED",
      history: [{ at: createdAt, text: decision.level === "PASS" ? "Checked and sent." : "Paused for you to review." }],
      ...extra,
    };
  };

  return {
    owner: { name: "Eleanor Hughes", firstName: "Eleanor" },
    plan: INITIAL_PLAN,
    planVersion: 1,
    planConfirmedAt: now - 40 * DAY,
    lastCheckinAt: now - 2 * DAY,
    contactAlerts: [],
    payments: [
      p("pay-pharmacy", "Riverside Pharmacy", 4210, 5, {}),
      p("pay-maria", "Maria (home care)", 32000, 3, { payeeIsRegisteredCaregiver: true }),
      p(
        "pay-support-desk",
        "Account Support Desk",
        120000,
        0.02,
        {
          payeeIsNew: true,
          amountRatioToTypical: 14,
          textLabels: ["GIFT_CARD_REQUEST", "URGENCY", "IMPERSONATION_TECH_SUPPORT"],
        },
        { method: "gift_card", note: "Buy gift cards today to unlock your account" },
        RECORDED_SCAM_SIGNAL,
      ),
    ],
  };
}

const g = globalThis as unknown as { __lpWorld?: World };

export function world(): World {
  g.__lpWorld ??= seed(Date.now());
  return g.__lpWorld;
}

export function resetWorld(): void {
  g.__lpWorld = seed(Date.now());
}

// ---------------------------------------------------------------------------
// Reads shaped for the screens
// ---------------------------------------------------------------------------

export function home() {
  const w = world();
  const policy = { ...DEFAULT_POLICY, ...w.plan.checkin };
  const due = nextDue(w.lastCheckinAt, policy);
  const paused = w.payments.filter((p) => p.status === "PAUSED" || p.status === "RELEASE_SCHEDULED" || p.status === "WAITING_FOR_CONTACT");
  return {
    owner: w.owner,
    contact: w.plan.trustedContact,
    timeZone: w.plan.checkin.timeZone,
    nextCheckinAt: due,
    lastCheckinAt: w.lastCheckinAt,
    needsAttention: paused,
    recent: [...w.payments].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6),
  };
}

export function payment(id: string): Payment | undefined {
  return world().payments.find((p) => p.id === id);
}

export function planView() {
  const w = world();
  return { plan: w.plan, version: w.planVersion, confirmedAt: w.planConfirmedAt, summary: summarisePlan(w.plan) };
}

// ---------------------------------------------------------------------------
// Owner actions
// ---------------------------------------------------------------------------

/** Scammers rely on urgency; a release of a high-risk hold waits this long and tells the contact. */
export const RELEASE_COOLING_OFF_MS = DAY;

export function checkIn(now = Date.now()): void {
  world().lastCheckinAt = now;
}

export type PaymentAction = "stop" | "ask-contact" | "send-anyway" | "cancel-release";

export function actOnPayment(id: string, action: PaymentAction, now = Date.now()): Payment {
  const w = world();
  const p = w.payments.find((x) => x.id === id);
  if (!p) throw new Error("Payment not found");
  const contact = w.plan.trustedContact.name;
  const amount = (p.amountMinor / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

  switch (action) {
    case "stop":
      if (!["PAUSED", "WAITING_FOR_CONTACT", "RELEASE_SCHEDULED"].includes(p.status)) break;
      p.status = "STOPPED_BY_OWNER";
      p.releaseAt = undefined;
      p.history.push({ at: now, text: "You chose not to send it. No money left your account." });
      break;
    case "ask-contact":
      if (p.status !== "PAUSED") break;
      p.status = "WAITING_FOR_CONTACT";
      p.history.push({ at: now, text: `We asked ${contact} to talk it over with you.` });
      w.contactAlerts.unshift({
        id: `alert-${now}`,
        at: now,
        paymentId: p.id,
        text: `${w.owner.firstName} would like to talk about a paused payment of ${amount} to someone new.`,
      });
      break;
    case "send-anyway":
      if (p.status !== "PAUSED" && p.status !== "WAITING_FOR_CONTACT") break;
      p.status = "RELEASE_SCHEDULED";
      p.releaseAt = now + RELEASE_COOLING_OFF_MS;
      p.history.push({ at: now, text: "You chose to send it. It will go in 24 hours unless you change your mind." });
      w.contactAlerts.unshift({
        id: `alert-${now}`,
        at: now,
        paymentId: p.id,
        text: `${w.owner.firstName} chose to send a paused payment of ${amount} to someone new. It goes in 24 hours.`,
      });
      break;
    case "cancel-release":
      if (p.status !== "RELEASE_SCHEDULED") break;
      p.status = "STOPPED_BY_OWNER";
      p.releaseAt = undefined;
      p.history.push({ at: now, text: "You changed your mind. It won't be sent." });
      break;
  }
  return p;
}

export type ConfirmResult = { ok: true; version: number } | { ok: false; issues: string[] };

export function confirmPlan(candidate: unknown, now = Date.now()): ConfirmResult {
  const parsed = PlanDocumentSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => i.message) };
  }
  const w = world();
  w.plan = parsed.data;
  w.planVersion += 1; // confirmed versions are never edited, only superseded (INV-09)
  w.planConfirmedAt = now;
  return { ok: true, version: w.planVersion };
}

export function previewPlan(candidate: unknown): { ok: true; summary: string[] } | { ok: false; issues: string[] } {
  const parsed = PlanDocumentSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((i) => i.message) };
  return { ok: true, summary: summarisePlan(parsed.data) };
}
