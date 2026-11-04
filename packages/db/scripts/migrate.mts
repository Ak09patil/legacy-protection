// Applies database migrations. Runs as the database owner (DATABASE_OWNER_URL),
// and sets the password of the least-privilege app role from LP_APP_PASSWORD.
import pg from "pg";
import { migrate } from "../src/migrate.js";

const url = process.env.DATABASE_OWNER_URL;
if (!url) {
  console.error("DATABASE_OWNER_URL is not set");
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const ran = await migrate(client, process.env.LP_APP_PASSWORD);
  console.log(ran.length ? `Applied: ${ran.join(", ")}` : "Database is up to date.");
} finally {
  await client.end();
}
