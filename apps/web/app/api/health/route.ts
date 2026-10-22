import { ping } from "@repo/db";
import { getDb } from "@repo/db/client";

/** Readiness probe for container health checks: is the app up and the database reachable? */
export async function GET() {
  try {
    await ping(getDb());
    return Response.json({ status: "ok" });
  } catch (error) {
    console.error("Health check failed", error);
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
