/** The vault service: `pnpm vault`. Its own database, its own secrets, nothing shared with the app. */

import pg from "pg";
import { masterKeyFrom } from "./core.js";
import { KeyStore } from "./keystore.js";
import { migrateVault } from "./migrate.js";
import { createVaultServer } from "./server.js";

const url = process.env.VAULT_DATABASE_URL;
if (!url) throw new Error("VAULT_DATABASE_URL is not set");
const pool = new pg.Pool({ connectionString: url, max: 5 });
pool.on("error", (e) => console.error(`[db] idle connection lost: ${e.message}`));
const c = await pool.connect();
try {
  const ran = await migrateVault(c);
  if (ran.length) console.log(`Vault migrations applied: ${ran.join(", ")}`);
} finally {
  c.release();
}
const store = new KeyStore(pool, masterKeyFrom(process.env.VAULT_MASTER_KEY));
const server = createVaultServer(store, { web: process.env.VAULT_SECRET_WEB, worker: process.env.VAULT_SECRET_WORKER });
const port = Number(process.env.VAULT_PORT ?? process.env.PORT ?? 8787);
server.listen(port, () => console.log(`Vault listening on ${port}`));
