/**
 * The connection string for the least-privilege app role. DATABASE_URL wins;
 * otherwise it's derived from the owner URL's host with user lp_app, so a
 * deployment never needs the owner's password outside migrations.
 */
export function appDatabaseUrl(env: Record<string, string | undefined> = process.env): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (env.DATABASE_OWNER_URL && env.LP_APP_PASSWORD) {
    const u = new URL(env.DATABASE_OWNER_URL);
    u.username = "lp_app";
    u.password = env.LP_APP_PASSWORD;
    return u.toString();
  }
  throw new Error("Set DATABASE_URL, or DATABASE_OWNER_URL and LP_APP_PASSWORD");
}
