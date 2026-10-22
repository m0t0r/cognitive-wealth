import { createDatabaseTest } from "@repo/testing/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { migrationsFolder } from "./migrations-folder";

/**
 * A `test` whose `orm` fixture is Drizzle over an isolated Postgres per test (`db` is the raw
 * PGlite). Migrations run once per worker into a template; each test gets its own clone.
 */
export const test = createDatabaseTest(async (client) => {
  await migrate(drizzle({ client }), { migrationsFolder });
}).extend("orm", ({ db }) => drizzle({ client: db }));
