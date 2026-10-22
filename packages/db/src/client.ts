import "server-only";
import type { Database } from "./index";
import { connectionConfig } from "./config";
import { connect } from "./connect";

const globalForDb = globalThis as typeof globalThis & { db?: Database };

/**
 * The app's Drizzle client. Connects on first use, so builds and routes that never query don't
 * need `DATABASE_URL`, and reuses one pool across dev hot reloads.
 */
export function getDb(): Database {
  return (globalForDb.db ??= connect(connectionConfig()).db);
}
