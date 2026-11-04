import "server-only";

/**
 * Tells the plan's durable timeline (a Temporal workflow) that something
 * changed, starting it if needed. The database is already correct by the
 * time this runs; this only makes sure the right timers are set. If Temporal
 * is briefly unreachable, the worker reconciles every active plan on start.
 */

import { Client, Connection } from "@temporalio/client";

const TASK_QUEUE = "legacy-protection";
const g = globalThis as unknown as { __lpTemporal?: Promise<Client | null> };

function client(): Promise<Client | null> {
  g.__lpTemporal ??= (async () => {
    const address = process.env.TEMPORAL_ADDRESS;
    if (!address) {
      console.warn("TEMPORAL_ADDRESS is not set: timers (check-ins, waiting periods, scheduled payments) won't run.");
      return null;
    }
    const connection = await Connection.connect({
      address,
      ...(process.env.TEMPORAL_API_KEY ? { tls: true, apiKey: process.env.TEMPORAL_API_KEY } : {}),
    });
    return new Client({ connection, namespace: process.env.TEMPORAL_NAMESPACE ?? "default" });
  })().catch((e) => {
    console.error("Could not connect to Temporal", e instanceof Error ? e.message : e);
    g.__lpTemporal = undefined;
    return null;
  });
  return g.__lpTemporal;
}

export async function pokeTimeline(planId: string): Promise<void> {
  try {
    const c = await client();
    if (!c) return;
    await c.workflow.signalWithStart("planTimeline", {
      taskQueue: TASK_QUEUE,
      workflowId: `plan-${planId}`,
      args: [{ planId }],
      signal: "changed",
      signalArgs: [],
    });
  } catch (e) {
    console.error("Timeline signal failed (the worker will reconcile)", e instanceof Error ? e.message : e);
  }
}
