import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));

/** Applies pending migrations in order, each in its own transaction. Run as the database owner. */
export async function migrate(client: pg.Client | pg.PoolClient, appRolePassword?: string): Promise<string[]> {
  await client.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'lp_app') THEN
      CREATE ROLE lp_app LOGIN;
    END IF;
  END $$;`);
  if (appRolePassword) {
    await client.query(`ALTER ROLE lp_app PASSWORD ${quoteLiteral(appRolePassword)}`);
  }
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  );

  const applied = new Set(
    (await client.query<{ name: string }>(`SELECT name FROM schema_migrations`)).rows.map((r) => r.name),
  );
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const ran: string[] = [];

  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, f), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [f]);
      await client.query("COMMIT");
      ran.push(f);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  }
  return ran;
}

function quoteLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

