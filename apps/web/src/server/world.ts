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

import { createHash } from "node:crypto";
import {
  DEFAULT_POLICY,
  deadlines,
  initialState,
  isMissed,
  moneyActionKey,
  nextDue,
  transition,
  type CheckinPolicy,
  type LifecycleEvent,
  type LifecycleState,
} from "@lp/core";
import {
  decide,
  evaluateRules,
  planExecution,
  PlanDocumentSchema,
  RULES_VERSION,
  summarisePlan,
  type Decision,
  type ExecutionStep,
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

export type Actor = "Eleanor" | "Priya" | "System" | "Risk engine";

/** One entry in the hash-chained audit trail (same chaining rule as packages/db). */
export interface AuditEntry {
  seq: number;
  at: number;
  actor: Actor;
  type: string;
  text: string;
  prevHash: string;
  hash: string;
}

export interface Subscription {
  id: string;
  name: string;
  amountMinor: number;
  status: "ACTIVE" | "CANCELLED";
}

export interface Invoice {
  id: string;
  to: string;
  description: string;
  amountMinor: number;
  status: "OPEN" | "CANCELLED";
}

export type RunStep = ExecutionStep & {
  label: string;
  status: "DONE" | "SCHEDULED";
  doneAt?: number;
  /** PayPal-Request-Id the executor would send; the same step can never move money twice (INV-03). */
  requestId: string;
};

interface World {
  owner: { name: string; firstName: string };
  clockOffsetMs: number;
  lifecycle: LifecycleState;
  audit: AuditEntry[];
  ownerNotices: Array<{ at: number; text: string }>;
  account: { balanceMinor: number; subscriptions: Subscription[]; invoices: Invoice[] };
  run: { activatedAt: number; steps: RunStep[] } | null;
  plan: PlanDocument;
  planVersion: number;
  planConfirmedAt: number;
  lastCheckinAt: number;
  payments: Payment[];
  contactAlerts: ContactAlert[];
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
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

  const planConfirmedAt = now - 40 * DAY;
  const w: World = {
    owner: { name: "Eleanor Hughes", firstName: "Eleanor" },
    clockOffsetMs: 0,
    lifecycle: initialState,
    audit: [],
    ownerNotices: [],
    account: {
      balanceMinor: 1_824_055,
      subscriptions: [
        { id: "I-STREAMTV", name: "Streaming TV", amountMinor: 1599, status: "ACTIVE" },
        { id: "I-DAILYNEWS", name: "Daily newspaper", amountMinor: 999, status: "ACTIVE" },
        { id: "I-PHOTOS", name: "Photo storage", amountMinor: 299, status: "ACTIVE" },
      ],
      invoices: [
        { id: "INV2-QUILT-0042", to: "Garden Quilting Circle", description: "Spring quilting class", amountMinor: 8000, status: "OPEN" },
      ],
    },
    run: null,
    plan: INITIAL_PLAN,
    planVersion: 1,
    planConfirmedAt,
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
  apply(w, { type: "PLAN_CONFIRMED", planVersionId: "eleanor-v1", waitingPeriodMs: INITIAL_PLAN.waitingPeriodHours * HOUR, at: planConfirmedAt }, "Eleanor", "Eleanor confirmed her plan (version 1).");
  for (const p of w.payments) {
    audit(w, p.createdAt, "Risk engine", "PAYMENT_DECIDED", `${p.payeeName}: ${p.decision.level === "PASS" ? "checked and sent" : "paused before any money moved"} (${p.decision.policyVersion}).`);
  }
  w.audit.sort((a, b) => a.at - b.at);
  rechain(w);
  return w;
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
  const due = nextDue(w.lastCheckinAt, checkinPolicy(w));
  const paused = w.payments.filter((p) => p.status === "PAUSED" || p.status === "RELEASE_SCHEDULED" || p.status === "WAITING_FOR_CONTACT");
  return {
    owner: w.owner,
    contact: w.plan.trustedContact,
    timeZone: w.plan.checkin.timeZone,
    nextCheckinAt: due,
    lastCheckinAt: w.lastCheckinAt,
    needsAttention: paused,
    phase: w.lifecycle.phase,
    checkinsMissed: w.lifecycle.checkinsMissed,
    waitingEndsAt: w.lifecycle.waitingStartedAt === null ? null : w.lifecycle.waitingStartedAt + w.lifecycle.waitingPeriodMs,
    notices: w.ownerNotices,
    now: now(),
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

export function checkIn(at = now()): void {
  const w = world();
  w.lastCheckinAt = at;
  ownerActivity(w, at, "Eleanor checked in.");
}

export type PaymentAction = "stop" | "ask-contact" | "send-anyway" | "cancel-release";

export function actOnPayment(id: string, action: PaymentAction, at = now()): Payment {
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
      p.history.push({ at, text: "You chose not to send it. No money left your account." });
      break;
    case "ask-contact":
      if (p.status !== "PAUSED") break;
      p.status = "WAITING_FOR_CONTACT";
      p.history.push({ at, text: `We asked ${contact} to talk it over with you.` });
      w.contactAlerts.unshift({
        id: `alert-${at}`,
        at,
        paymentId: p.id,
        text: `${w.owner.firstName} would like to talk about a paused payment of ${amount} to someone new.`,
      });
      break;
    case "send-anyway":
      if (p.status !== "PAUSED" && p.status !== "WAITING_FOR_CONTACT") break;
      p.status = "RELEASE_SCHEDULED";
      p.releaseAt = at + RELEASE_COOLING_OFF_MS;
      p.history.push({ at, text: "You chose to send it. It will go in 24 hours unless you change your mind." });
      w.contactAlerts.unshift({
        id: `alert-${at}`,
        at,
        paymentId: p.id,
        text: `${w.owner.firstName} chose to send a paused payment of ${amount} to someone new. It goes in 24 hours.`,
      });
      break;
    case "cancel-release":
      if (p.status !== "RELEASE_SCHEDULED") break;
      p.status = "STOPPED_BY_OWNER";
      p.releaseAt = undefined;
      p.history.push({ at, text: "You changed your mind. It won't be sent." });
      break;
  }
  ownerActivity(w, at, `Eleanor decided on the paused payment to ${p.payeeName}: ${p.history[p.history.length - 1]!.text}`);
  return p;
}

export type ConfirmResult = { ok: true; version: number } | { ok: false; issues: string[] };

export function confirmPlan(candidate: unknown, at = now()): ConfirmResult {
  const parsed = PlanDocumentSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => i.message) };
  }
  const w = world();
  if (w.run) return { ok: false, issues: ["This plan has already started, so it can no longer be changed."] };
  ownerActivity(w, at, "Eleanor opened her plan.");
  const version = w.planVersion + 1; // confirmed versions are never edited, only superseded (INV-09)
  const rejected = apply(
    w,
    { type: "PLAN_CONFIRMED", planVersionId: `eleanor-v${version}`, waitingPeriodMs: parsed.data.waitingPeriodHours * HOUR, at },
    "Eleanor",
    `Eleanor confirmed a new version of her plan (version ${version}).`,
  );
  if (rejected) return { ok: false, issues: [rejected] };
  w.plan = parsed.data;
  w.planVersion = version;
  w.planConfirmedAt = at;
  return { ok: true, version };
}

export function previewPlan(candidate: unknown): { ok: true; summary: string[] } | { ok: false; issues: string[] } {
  const parsed = PlanDocumentSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((i) => i.message) };
  return { ok: true, summary: summarisePlan(parsed.data) };
}

// ---------------------------------------------------------------------------
// Clock, lifecycle and audit
// ---------------------------------------------------------------------------

/** Story time. Judge mode moves it forward; everything else reads it. */
export function now(): number {
  return Date.now() + (g.__lpWorld?.clockOffsetMs ?? 0);
}

function checkinPolicy(w: World): CheckinPolicy {
  return { ...DEFAULT_POLICY, ...w.plan.checkin };
}

const GENESIS = "0".repeat(64);

function hashOf(e: Omit<AuditEntry, "hash">): string {
  const body = JSON.stringify([e.seq, e.at, e.actor, e.type, e.text, e.prevHash]);
  return createHash("sha256").update(body).digest("hex");
}

function audit(w: World, at: number, actor: Actor, type: string, text: string): void {
  const prev = w.audit[w.audit.length - 1];
  const base = { seq: w.audit.length + 1, at, actor, type, text, prevHash: prev?.hash ?? GENESIS };
  w.audit.push({ ...base, hash: hashOf(base) });
}

function rechain(w: World): void {
  let prev = GENESIS;
  w.audit = w.audit.map((e, i) => {
    const base = { seq: i + 1, at: e.at, actor: e.actor, type: e.type, text: e.text, prevHash: prev };
    const hash = hashOf(base);
    prev = hash;
    return { ...base, hash };
  });
}

/** Recomputes every link. Any edited, removed or reordered entry breaks the chain from that point. */
export function verifyAudit(): { ok: true; length: number; head: string } | { ok: false; brokenAt: number } {
  const w = world();
  let prev = GENESIS;
  for (const e of w.audit) {
    if (e.prevHash !== prev || hashOf(e) !== e.hash) return { ok: false, brokenAt: e.seq };
    prev = e.hash;
  }
  return { ok: true, length: w.audit.length, head: prev };
}

/** Runs one lifecycle event through the real state machine and carries out its effects. Returns a rejection reason, if any. */
function apply(w: World, event: LifecycleEvent, actor: Actor, text: string): string | null {
  const t = transition(w.lifecycle, event);
  const rejected = t.effects.find((e) => e.type === "REJECTED");
  if (rejected && rejected.type === "REJECTED") return rejected.reason;
  const before = w.lifecycle.phase;
  w.lifecycle = t.state;
  audit(w, event.at, actor, event.type, text);
  if (before !== t.state.phase) audit(w, event.at, "System", "PHASE_CHANGED", `Plan moved from ${before.toLowerCase()} to ${t.state.phase.toLowerCase()}.`);
  const contact = w.plan.trustedContact.name;
  const first = w.owner.firstName;
  for (const e of t.effects) {
    if (e.type === "NOTIFY_OWNER_ALL_CHANNELS") {
      const msg = {
        CONTACT_CONFIRMED: `${contact} told us something may have happened to you. If you’re all right, tap “I’m here” and everything stops.`,
        WAITING_STARTED: `Your plan will start in ${Math.round(w.lifecycle.waitingPeriodMs / DAY)} days unless we hear from you. One tap stops it.`,
        ACTIVATED: "Your plan has started.",
      }[e.reason];
      w.ownerNotices.unshift({ at: event.at, text: msg });
      audit(w, event.at, "System", "OWNER_NOTIFIED", `${first} was told on every channel: ${e.reason.toLowerCase().replaceAll("_", " ")}.`);
    } else if (e.type === "NOTIFY_CONTACT") {
      const msg = {
        ACTIVATION_CANCELLED_BY_OWNER: `${first} is all right. She checked in, so nothing will happen. Thank you for looking out for her.`,
        ACTIVATED: `${first}’s plan has started. Her balance is safe for her estate, and her executor has been sent what they need.`,
      }[e.reason];
      w.contactAlerts.unshift({ id: `alert-${event.at}-${e.reason}`, at: event.at, text: msg });
      audit(w, event.at, "System", "CONTACT_NOTIFIED", `${contact} was told: ${e.reason.toLowerCase().replaceAll("_", " ")}.`);
    }
  }
  return null;
}

/** Any sign of the owner cancels all progress toward activation (INV-07). */
function ownerActivity(w: World, at: number, text: string): void {
  const s = w.lifecycle;
  const progressing = s.phase === "WAITING" || s.checkinsMissed || s.contactConfirmed;
  apply(w, { type: "OWNER_ACTIVITY", at }, "Eleanor", text);
  if (progressing) w.ownerNotices = [];
}

// ---------------------------------------------------------------------------
// The story: what happens when Eleanor can't act
// ---------------------------------------------------------------------------

export type StoryStep = "missed" | "confirmed" | "started";

export function story() {
  const w = world();
  const s = w.lifecycle;
  const due = nextDue(w.lastCheckinAt, checkinPolicy(w));
  return {
    phase: s.phase,
    checkinsMissed: s.checkinsMissed,
    contactConfirmed: s.contactConfirmed,
    waitingStartedAt: s.waitingStartedAt,
    waitingEndsAt: s.waitingStartedAt === null ? null : s.waitingStartedAt + s.waitingPeriodMs,
    dueAt: due,
    missedAt: deadlines(due, checkinPolicy(w)).missedAt,
    lastCheckinAt: w.lastCheckinAt,
    now: now(),
    timeZone: w.plan.checkin.timeZone,
    owner: w.owner,
    contact: w.plan.trustedContact,
    contactAlerts: w.contactAlerts,
    run: w.run,
    account: w.account,
    planVersion: w.planVersion,
    payments: w.payments,
    plan: w.plan,
  };
}

/** Judge mode: move story time forward. Never backwards, so nothing can be undone by the clock. */
function advanceTo(w: World, at: number): void {
  if (at > now()) w.clockOffsetMs += at - now();
}

/** Step 1: Eleanor stops checking in. Time moves past her reminders until the check-in counts as missed. */
export function storyMissCheckins(): string | null {
  const w = world();
  if (w.lifecycle.phase !== "MONITORING") return "The story has already moved past this point.";
  const policy = checkinPolicy(w);
  const due = nextDue(w.lastCheckinAt, policy);
  const d = deadlines(due, policy);
  for (const r of d.reminders) {
    advanceTo(w, r);
    audit(w, r, "System", "CHECKIN_REMINDER_SENT", `Reminder sent to ${w.owner.firstName} by app, email and text. No reply.`);
  }
  advanceTo(w, d.missedAt + 60_000);
  if (!isMissed(due, w.lastCheckinAt, now(), policy)) return "Check-in isn't missed yet.";
  const at = now();
  w.contactAlerts.unshift({
    id: `alert-${at}-missed`,
    at,
    text: `${w.owner.firstName} hasn’t checked in, and hasn’t answered two reminders. Could you try to reach her?`,
  });
  apply(w, { type: "CHECKIN_SEQUENCE_MISSED", at }, "System", `${w.owner.firstName} missed her check-in and both reminders.`);
  return null;
}

/** Step 2: Priya confirms, with a passkey. Without the passkey the state machine refuses. */
export function contactConfirm(passkeyVerified: boolean): string | null {
  const w = world();
  if (w.lifecycle.phase !== "MONITORING") return "There’s nothing to confirm right now.";
  if (!w.lifecycle.checkinsMissed) return `${w.owner.firstName} has been checking in, so there’s nothing to confirm.`;
  return apply(
    w,
    { type: "CONTACT_CONFIRMED", passkeyVerified, at: now() },
    "Priya",
    `${w.plan.trustedContact.name} confirmed with her passkey that something has happened.`,
  );
}

/** Step 3: the waiting period passes with no word from the owner, so the plan runs. */
export function storyFinishWaiting(): string | null {
  const w = world();
  const s = w.lifecycle;
  if (s.phase !== "WAITING" || s.waitingStartedAt === null) return "The plan isn't waiting.";
  advanceTo(w, s.waitingStartedAt + s.waitingPeriodMs + 60_000);
  const rejected = apply(w, { type: "WAITING_PERIOD_CHECK", at: now() }, "System", `The ${Math.round(s.waitingPeriodMs / DAY)}-day wait ended with no word from ${w.owner.firstName}.`);
  if (rejected) return rejected;
  execute(w);
  return null;
}

function execute(w: World): void {
  const at = now();
  apply(w, { type: "EXECUTION_STARTED", at }, "System", "The executor started running the confirmed plan.");
  const planVersionId = `eleanor-v${w.planVersion}`;
  const snapshot = {
    activeSubscriptionIds: w.account.subscriptions.filter((x) => x.status === "ACTIVE").map((x) => x.id),
    openInvoiceIds: w.account.invoices.filter((x) => x.status === "OPEN").map((x) => x.id),
  };
  const steps = planExecution(w.plan, snapshot, at);
  const obligation = (id: string) => w.plan.obligations.find((o) => o.id === id);
  w.run = {
    activatedAt: at,
    steps: steps.map((st) => {
      let label = "";
      if (st.type === "CANCEL_SUBSCRIPTION") label = `Stop ${w.account.subscriptions.find((x) => x.id === st.subscriptionId)?.name ?? "subscription"}`;
      if (st.type === "CANCEL_INVOICE") label = `Cancel unpaid invoice to ${w.account.invoices.find((x) => x.id === st.invoiceId)?.to ?? "a customer"}`;
      if (st.type === "PAY_OBLIGATION") label = `Pay ${obligation(st.obligationId)?.payeeName ?? "carer"} ${(st.amountMinor / 100).toLocaleString("en-US", { style: "currency", currency: st.currency })}`;
      if (st.type === "ASSEMBLE_EXECUTOR_PACKAGE") label = "Prepare the executor’s package";
      return { ...st, label, status: "SCHEDULED" as const, requestId: moneyActionKey(planVersionId, st.id) };
    }),
  };
  for (const st of w.run.steps) {
    if (st.type === "PAY_OBLIGATION" && st.dueAt > at) continue;
    st.status = "DONE";
    st.doneAt = at;
    if (st.type === "CANCEL_SUBSCRIPTION") {
      const sub = w.account.subscriptions.find((x) => x.id === st.subscriptionId);
      if (sub) sub.status = "CANCELLED";
    }
    if (st.type === "CANCEL_INVOICE") {
      const inv = w.account.invoices.find((x) => x.id === st.invoiceId);
      if (inv) inv.status = "CANCELLED";
    }
    if (st.type === "PAY_OBLIGATION") w.account.balanceMinor -= st.amountMinor;
    audit(w, at, "System", st.type, `${st.label}. Request ${st.requestId.slice(0, 15)}…`);
  }
  audit(w, at, "System", "BALANCE_HELD", "Remaining balance held for the estate. No step can send it anywhere (INV-04).");
}

export function auditTrail(): AuditEntry[] {
  return world().audit;
}
