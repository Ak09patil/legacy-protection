/** The Temporal worker process: `pnpm --filter @lp/executor start`. */

import { fileURLToPath } from "node:url";
import { Client, Connection } from "@temporalio/client";
import { NativeConnection, Worker } from "@temporalio/worker";
import pg from "pg";
import { createActivities, executorFromEnv } from "./activities.js";

export const TASK_QUEUE = "legacy-protection";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
  const executor = executorFromEnv();
  const connection = await NativeConnection.connect({
    address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
    ...(process.env.TEMPORAL_API_KEY ? { tls: true, apiKey: process.env.TEMPORAL_API_KEY } : {}),
  });
  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? "default",
    taskQueue: TASK_QUEUE,
    workflowsPath: fileURLToPath(new URL("./workflows.ts", import.meta.url)),
    activities: createActivities(pool, executor),
  });
  console.log(`Worker running (executor: ${executor.name})`);
  const running = worker.run();
  await reconcile(pool);
  await running;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Makes sure every active plan has a running timeline. Signals from the app
 * can be lost if Temporal was briefly unreachable; this closes that gap.
 */
async function reconcile(pool: pg.Pool) {
  const connection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
    ...(process.env.TEMPORAL_API_KEY ? { tls: true, apiKey: process.env.TEMPORAL_API_KEY } : {}),
  });
  const client = new Client({ connection, namespace: process.env.TEMPORAL_NAMESPACE ?? "default" });
  const active = await pool.query<{ plan_id: string }>(`SELECT plan_id FROM plan_state WHERE phase NOT IN ('COMPLETED', 'CANCELLED', 'DRAFT')`);
  for (const { plan_id } of active.rows) {
    await client.workflow.signalWithStart("planTimeline", {
      taskQueue: TASK_QUEUE,
      workflowId: `plan-${plan_id}`,
      args: [{ planId: plan_id }],
      signal: "changed",
      signalArgs: [],
    });
  }
  console.log(`Reconciled ${active.rowCount} active plan(s)`);
}
