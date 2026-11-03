/**
 * The side effects the plan workflow may ask for. Workflows only see these
 * signatures; implementations live in activities.ts (I/O happens there).
 */

import type { ExecutionStep } from "@lp/policy";

export interface CheckinWindow {
  readonly dueAt: number;
  readonly reminders: readonly number[];
  readonly missedAt: number;
}

export interface Activities {
  /** Next check-in window after the owner's last activity, in the owner's time zone (INV-20). */
  nextCheckin(planId: string, lastActivityAt: number): Promise<CheckinWindow>;
  sendCheckinReminder(planId: string, dueAt: number, n: number): Promise<void>;
  notifyOwnerAllChannels(planId: string, reason: string): Promise<void>;
  notifyContact(planId: string, reason: string): Promise<void>;
  /** Appends to the hash-chained audit log in the same transaction as any state write (INV-15). */
  audit(planId: string, kind: string, payload: Record<string, unknown>): Promise<void>;
  /** Derives the only steps the activated plan may run, from the confirmed version (INV-02, INV-04). */
  planSteps(planId: string, planVersionId: string, activatedAt: number): Promise<ExecutionStep[]>;
  /** Runs one step. Idempotent by (planVersionId, step.id) (INV-03). */
  executeStep(planId: string, planVersionId: string, step: ExecutionStep): Promise<{ outcome: string }>;
}
