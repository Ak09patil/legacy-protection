import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";

const DIR = fileURLToPath(new URL("../migrations", import.meta.url));

/** Applies the vault's own migrations to the vault database. */
export async function migrateVault(client: pg.Client | pg.PoolClient): Promise<string[]> {
  await client.query(`CREATE TABLE IF NOT EXISTS vault_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await client.query<{ name: string }>(`SELECT name FROM vault_migrations`)).rows.map((r) => r.name));
  const ran: string[] = [];
  for (const f of (await readdir(DIR)).filter((x) => x.endsWith(".sql")).sort()) {
    if (done.has(f)) continue;
    await client.query("BEGIN");
    try {
      await client.query(await readFile(join(DIR, f), "utf8"));
      await client.query(`INSERT INTO vault_migrations (name) VALUES ($1)`, [f]);
      await client.query("COMMIT");
      ran.push(f);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  }
  return ran;
}
