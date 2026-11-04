/**
 * One durable timeline per plan (ADR-0001). It owns no state: Postgres is the
 * source of truth. The workflow only waits (on Temporal timers that survive
 * restarts and deploys) and, when a timer fires or the app signals a change,
 * asks an activity to re-check the database and act if the rules allow.
 *
 * Deterministic by construction: no I/O, no randomness, time only from the
 * workflow clock (passed to activities as `now`).
 */

import { condition, continueAsNew, defineSignal, proxyActivities, setHandler } from "@temporalio/workflow";
import type { Activities } from "./activity-types.js";

const quick = proxyActivities<Activities>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 10, initialInterval: "1 second", backoffCoefficient: 2 },
});

// Money steps retry for up to a day; every attempt reuses the step's PayPal-Request-Id (INV-03).
const money = proxyActivities<Activities>({
  startToCloseTimeout: "2 minutes",
  retry: { initialInterval: "5 seconds", backoffCoefficient: 2, maximumInterval: "30 minutes" },
  scheduleToCloseTimeout: "24 hours",
});

/** Sent by the app whenever something changes: a check-in, a new plan version, a confirmation. */
export const changedSignal = defineSignal<[]>("changed");

export interface PlanTimelineInput {
  readonly planId: string;
}

const LOOPS_BEFORE_CONTINUE_AS_NEW = 200;

export async function planTimeline({ planId }: PlanTimelineInput): Promise<string> {
  let changed = false;
  setHandler(changedSignal, () => {
    changed = true;
  });
  /** Waits until `at` (workflow time), returning early if the app signals a change. */
  const waitUntil = async (at: number | null): Promise<boolean> => {
    const woke = at === null ? await condition(() => changed).then(() => true) : await condition(() => changed, Math.max(0, at - Date.now()));
    return woke;
  };

  for (let i = 0; i < LOOPS_BEFORE_CONTINUE_AS_NEW; i++) {
    changed = false;
    const t = await quick.loadTimeline(planId);
    if (!t) return "NO_PLAN";

    switch (t.phase) {
      case "COMPLETED":
      case "CANCELLED":
        return t.phase;

      case "DRAFT":
        await waitUntil(null);
        break;

      case "MONITORING": {
        if (t.checkinsMissed || !t.window) {
          await waitUntil(null); // waiting for the contact or the owner
          break;
        }
        const now = Date.now();
        const marks = [...t.window.reminders.map((at, k) => ({ at, n: k + 1 })), { at: t.window.missedAt, n: 0 }];
        const next = marks.find((m) => m.at > now) ?? marks[marks.length - 1]!;
        if (await waitUntil(next.at)) break;
        if (next.n > 0) await quick.sendReminder(planId, t.window.dueAt, next.n);
        else await quick.markMissedIfDue(planId, Date.now());
        break;
      }

      case "WAITING":
        if (await waitUntil(t.waitingEndsAt)) break;
        await quick.finishWaitingIfDue(planId, Date.now());
        break;

      case "ACTIVATED":
        await quick.startExecution(planId, Date.now());
        break;

      case "EXECUTING": {
        const pending = await quick.pendingSteps(planId);
        if (pending.length === 0) {
          await quick.completeIfAllDone(planId, Date.now());
          break;
        }
        const next = pending[0]!;
        if (next.dueAt > Date.now()) {
          await waitUntil(next.dueAt);
          break;
        }
        await money.runStep(planId, next.id, Date.now());
        break;
      }
    }
  }
  return continueAsNew<typeof planTimeline>({ planId });
}
