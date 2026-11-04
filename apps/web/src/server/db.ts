import "server-only";
import pg from "pg";

/**
 * One pool per server process, connected as the least-privilege app role
 * (lp_app). The app role cannot update or delete the audit log or confirmed
 * plan versions; that is enforced by Postgres, not by this code.
 */
const g = globalThis as unknown as { __lpPool?: pg.Pool };

export function db(): pg.Pool {
  if (!g.__lpPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    g.__lpPool = new pg.Pool({
      connectionString,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      statement_timeout: 10_000,
      ssl: process.env.DATABASE_SSL === "require" ? { rejectUnauthorized: true } : undefined,
    });
  }
  return g.__lpPool;
}

export type Tx = pg.PoolClient;

/** Runs `fn` in one transaction. Commits on success, rolls back on any error. */
export async function tx<T>(fn: (c: Tx) => Promise<T>): Promise<T> {
  const c = await db().connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}
