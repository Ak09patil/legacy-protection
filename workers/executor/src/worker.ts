/** The Temporal worker process: `pnpm --filter @lp/executor start`. */

import { fileURLToPath } from "node:url";
import { Client, Connection } from "@temporalio/client";
import { NativeConnection, Worker } from "@temporalio/worker";
import pg from "pg";
import { appDatabaseUrl } from "@lp/db/url";
import { configureVault, deliverDue, mailerFromEnv } from "@lp/service";
import { httpVault } from "@lp/vault";
import { createActivities, executorFromEnv } from "./activities.js";

export const TASK_QUEUE = "legacy-protection";

async function main() {
  const databaseUrl = appDatabaseUrl();
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
  // A dropped idle connection (database restart, failover) must not crash the worker; the pool reconnects.
  pool.on("error", (e) => console.error(`[db] idle connection lost: ${e.message}`));
  const executor = executorFromEnv();
  // The worker's own vault identity: it may open plan documents to run a plan, never payment notes (INV-24).
  const vaultUrl = process.env.VAULT_URL ?? (process.env.VAULT_HOSTPORT ? `http://${process.env.VAULT_HOSTPORT}` : undefined);
  if (vaultUrl && process.env.VAULT_SECRET_WORKER) configureVault(httpVault(vaultUrl, "worker", process.env.VAULT_SECRET_WORKER));
  else if (process.env.NODE_ENV === "production") throw new Error("VAULT_URL and VAULT_SECRET_WORKER must be set in production");
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
  deliverForever(pool);
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

/**
 * Sends the outbox every 15 seconds: reminders, alerts and invitations. A
 * failure is logged and retried later; it never stops the worker.
 */
function deliverForever(pool: pg.Pool) {
  const mailer = mailerFromEnv();
  console.log(`Outbox delivery on (${mailer.name})`);
  const tick = async () => {
    try {
      const r = await deliverDue(pool, mailer);
      if (r.sent || r.failed) console.log(`[outbox] sent ${r.sent}, failed ${r.failed}`);
    } catch (e) {
      console.error(`[outbox] ${e instanceof Error ? e.message : e}`);
    }
    setTimeout(tick, 15_000).unref();
  };
  void tick();
}
