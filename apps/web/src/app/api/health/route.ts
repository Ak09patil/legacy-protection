import { db } from "@/server/db";

export const dynamic = "force-dynamic";

/** For the load balancer: the app is up and can reach its database. No details leaked. */
export async function GET() {
  try {
    await db().query("SELECT 1");
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
