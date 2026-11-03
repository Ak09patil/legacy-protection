# ADR-0001: Temporal for the plan lifecycle

- **Status:** Accepted. Spike passed on 2026-11-03 (see Spike result)
- **Date:** 2026-11-02

## Context

A plan runs for months or years. Its lifecycle needs:

- timers measured in days or weeks (check-in intervals, waiting periods);
- outside events that change its course at any time (owner check-in, contact confirmation, owner cancel);
- a multi-step execution phase (stop subscriptions, cancel open invoices, continue caregiver payments, assemble the executor package) where a failure halfway through must be retried or compensated, and no step may run twice (INV-03).

## Options

1. **Database state machine plus a cron tick.** Simple, few moving parts. We would hand-build retries, timers, signal handling and compensation, which is where subtle bugs live.
2. **Render Workflows.** Durable tasks with retries, and native to our host. In public beta; pause/resume and cron triggers are listed as upcoming, which are exactly what long waits need.
3. **Temporal.** Durable timers of any length, signals and queries, deterministic replay, saga-style compensation, and a complete event history per workflow. Adds an infrastructure component.

## Decision

Use **Temporal** for the plan lifecycle and execution. Workflows are written in TypeScript; the Python risk service runs as a separate activity worker on its own task queue (Temporal supports workers in multiple languages).

The lifecycle's rules live in a pure state machine (`packages/core/lifecycle.ts`) that the Temporal workflow drives. The business logic does not depend on Temporal.

## Consequences

- Long waits are `sleep` calls inside a workflow; owner activity is a signal that cancels them (INV-07).
- Workflow history doubles as an operational record alongside the audit log.
- Workflow code must be deterministic. Non-deterministic work (I/O, time, randomness) lives in activities.
- **Spike rule:** on Day 1 we get one plan running end to end on Temporal (Temporal Cloud or self-hosted on Render). If it isn't working by the end of that day, we switch to option 1 using the same `lifecycle.ts`, and record that in ADR-0006.

## Spike result (2026-11-03)

The lifecycle runs on Temporal's time-skipping test server (`workers/executor/test/workflow.test.ts`):

- full path: missed check-ins with two reminders, passkey-confirmed contact, 72-hour wait, activation, execution of every planned step;
- owner activity a day into the waiting period cancels activation; nothing executes in the following ten days (INV-07);
- a contact confirmation without a passkey changes nothing (INV-06);
- a payment that fails twice after PayPal acted is retried with the same key and has exactly one effect (INV-03);
- the worker is shut down between two scheduled payouts and a fresh worker with no cached state finishes the plan by replaying history, with each step taking effect exactly once (INV-03).

The database-plus-cron fallback is not needed.
