/**
 * The plan lifecycle as a durable Temporal workflow (ADR-0001).
 *
 * The rules live in @lp/core/lifecycle (pure, exhaustively tested); this file
 * only drives them: it waits on timers and signals, turns effects into
 * activities, and records every transition in the audit log.
 *
 * Deterministic by construction: no I/O, no randomness, time only from the
 * workflow clock.
 */

import {
  condition,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
  sleep,
} from "@temporalio/workflow";
import { initialState, transition, type Effect, type LifecycleEvent, type LifecycleState } from "@lp/core/lifecycle";
import type { Activities } from "./activity-types.js";

const quick = proxyActivities<Activities>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 10, initialInterval: "1 second", backoffCoefficient: 2 },
});

// Money steps retry for up to a day; each attempt reuses the same idempotency key (INV-03).
const money = proxyActivities<Activities>({
  startToCloseTimeout: "2 minutes",
  retry: { initialInterval: "5 seconds", backoffCoefficient: 2, maximumInterval: "30 minutes" },
  scheduleToCloseTimeout: "24 hours",
});

export const ownerActivitySignal = defineSignal<[]>("ownerActivity");
export const ownerCancelledSignal = defineSignal<[]>("ownerCancelled");
export const contactConfirmedSignal = defineSignal<[{ passkeyVerified: boolean }]>("contactConfirmed");
export const stateQuery = defineQuery<LifecycleState>("state");

export interface PlanLifecycleInput {
  readonly planId: string;
  readonly planVersionId: string;
  readonly waitingPeriodMs: number;
}

export async function planLifecycle(input: PlanLifecycleInput): Promise<LifecycleState> {
  const { planId } = input;
  let state: LifecycleState = initialState;
  const inbox: LifecycleEvent[] = [];
  let lastOwnerActivity = Date.now();

  setHandler(stateQuery, () => state);
  setHandler(ownerActivitySignal, () => {
    lastOwnerActivity = Date.now();
    inbox.push({ type: "OWNER_ACTIVITY", at: Date.now() });
  });
  setHandler(ownerCancelledSignal, () => {
    inbox.push({ type: "OWNER_CANCELLED", at: Date.now() });
  });
  setHandler(contactConfirmedSignal, (c) => {
    inbox.push({ type: "CONTACT_CONFIRMED", passkeyVerified: c.passkeyVerified, at: Date.now() });
  });

  async function apply(event: LifecycleEvent): Promise<void> {
    const before = state.phase;
    const t = transition(state, event);
    state = t.state;
    await quick.audit(planId, "LIFECYCLE", {
      event: event.type,
      from: before,
      to: state.phase,
      effects: t.effects.map((e) => e.type),
    });
    for (const e of t.effects) await runEffect(e);
  }

  async function runEffect(e: Effect): Promise<void> {
    switch (e.type) {
      case "NOTIFY_OWNER_ALL_CHANNELS":
        return quick.notifyOwnerAllChannels(planId, e.reason);
      case "NOTIFY_CONTACT":
        return quick.notifyContact(planId, e.reason);
      case "SCHEDULE_WAITING_CHECK":
      case "REJECTED":
        return; // timers are handled by the loop; rejections are already audited
    }
  }

  async function drainInbox(): Promise<void> {
    while (inbox.length) await apply(inbox.shift()!);
  }

  await apply({
    type: "PLAN_CONFIRMED",
    planVersionId: input.planVersionId,
    waitingPeriodMs: input.waitingPeriodMs,
    at: Date.now(),
  });

  while (state.phase === "MONITORING" || state.phase === "WAITING") {
    if (state.phase === "MONITORING" && !state.checkinsMissed) {
      // Wait out one check-in window, with reminders, unless the owner shows up.
      const w = await quick.nextCheckin(planId, lastOwnerActivity);
      const seen = lastOwnerActivity;
      const ownerShowedUp = () => lastOwnerActivity !== seen || inbox.length > 0;
      let n = 0;
      for (const at of [...w.reminders, w.missedAt]) {
        if (await condition(ownerShowedUp, Math.max(0, at - Date.now()))) break;
        if (at !== w.missedAt) await quick.sendCheckinReminder(planId, w.dueAt, ++n);
      }
      if (ownerShowedUp()) {
        await drainInbox();
        continue;
      }
      await apply({ type: "CHECKIN_SEQUENCE_MISSED", at: Date.now() });
      continue;
    }

    if (state.phase === "MONITORING") {
      // Check-ins missed: wait for the contact's confirmation or the owner.
      await condition(() => inbox.length > 0);
      await drainInbox();
      continue;
    }

    // WAITING: the full waiting period must pass with no owner activity (INV-06, INV-07).
    const started = state.waitingStartedAt!;
    const interrupted = await condition(
      () => inbox.length > 0,
      Math.max(0, started + state.waitingPeriodMs - Date.now()),
    );
    if (interrupted) {
      await drainInbox();
      continue;
    }
    await apply({ type: "WAITING_PERIOD_CHECK", at: Date.now() });
  }

  if (state.phase !== "ACTIVATED") return state; // cancelled

  await apply({ type: "EXECUTION_STARTED", at: Date.now() });
  const activatedAt = Date.now();
  const steps = await quick.planSteps(planId, input.planVersionId, activatedAt);
  for (const step of steps) {
    if (step.type === "PAY_OBLIGATION" && step.dueAt > Date.now()) {
      await sleep(step.dueAt - Date.now());
    }
    const r = await money.executeStep(planId, input.planVersionId, step);
    await quick.audit(planId, "STEP_EXECUTED", { stepId: step.id, type: step.type, outcome: r.outcome });
  }
  await apply({ type: "EXECUTION_COMPLETED", at: Date.now() });
  return state;
}
