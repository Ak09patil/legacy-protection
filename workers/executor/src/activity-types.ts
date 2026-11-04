/**
 * What the timeline workflow may ask for. Every activity re-reads Postgres and
 * re-checks its condition before acting, and takes the workflow's clock as
 * `now`, so timers decide *when* to look and the database decides *whether*
 * anything happens (INV-06, INV-07, INV-20).
 */

import type { Timeline } from "@lp/service";

export interface Activities {
  loadTimeline(planId: string): Promise<Timeline | null>;
  sendReminder(planId: string, dueAt: number, n: number): Promise<"SENT" | "SKIPPED">;
  markMissedIfDue(planId: string, now: number): Promise<boolean>;
  finishWaitingIfDue(planId: string, now: number): Promise<boolean>;
  startExecution(planId: string, now: number): Promise<boolean>;
  pendingSteps(planId: string): Promise<Array<{ id: string; dueAt: number }>>;
  /** Runs one step through the policy gate. Idempotent by (planVersionId, stepId) (INV-03). */
  runStep(planId: string, stepId: string, now: number): Promise<{ outcome: "DONE" | "REFUSED" | "SKIPPED"; detail?: string }>;
  completeIfAllDone(planId: string, now: number): Promise<boolean>;
}
