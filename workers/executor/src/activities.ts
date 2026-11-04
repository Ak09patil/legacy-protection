/** Real activities: Postgres through @lp/service, PayPal through the policy gate. */

import { PayPalClient } from "@lp/paypal";
import { completeIfAllDone, DryRunExecutor, finishWaitingIfDue, loadTimeline, markMissedIfDue, PayPalExecutor, pendingSteps, runStep, sendReminder, startExecution, type Executor } from "@lp/service";
import type pg from "pg";
import type { Activities } from "./activity-types.js";

export function executorFromEnv(env = process.env): Executor {
  if (env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET) {
    return new PayPalExecutor(new PayPalClient({ clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_CLIENT_SECRET }));
  }
  return new DryRunExecutor();
}

export function createActivities(pool: pg.Pool, executor: Executor): Activities {
  return {
    loadTimeline: (planId) => loadTimeline(pool, planId),
    sendReminder: (planId, dueAt, n) => sendReminder(pool, planId, dueAt, n),
    markMissedIfDue: (planId, now) => markMissedIfDue(pool, planId, now),
    finishWaitingIfDue: (planId, now) => finishWaitingIfDue(pool, planId, now),
    startExecution: (planId, now) => startExecution(pool, planId, executor, now),
    pendingSteps: (planId) => pendingSteps(pool, planId),
    runStep: (planId, stepId, now) => runStep(pool, planId, stepId, executor, now),
    completeIfAllDone: (planId, now) => completeIfAllDone(pool, planId, now),
  };
}
