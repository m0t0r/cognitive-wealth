import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

/** Any Drizzle Postgres database: the app's `getDb()` client or a test's `orm`. */
export type Database = PgDatabase<PgQueryResultHKT>;

/** Round-trips to the database; throws if it is unreachable. */
export async function ping(db: Database) {
  await db.execute(sql`select 1`);
}
