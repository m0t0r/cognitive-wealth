import { createDatabaseTest } from "@repo/testing/pglite";
import { type Role, createPostgresTest } from "@repo/testing/postgres";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { connect as connectPool } from "./connect";
import { migrationsFolder } from "./migrations-folder";

/**
 * A `test` whose `orm` fixture is Drizzle over an isolated Postgres per test (`db` is the raw
 * PGlite). Migrations run once per worker into a template; each test gets its own clone.
 */
export const test = createDatabaseTest(async (client) => {
  await migrate(drizzle({ client }), { migrationsFolder });
}).extend("orm", ({ db }) => drizzle({ client: db }));

// postgres.js's Drizzle type, so `execute` returns rows rather than the shared `Database`'s unknown.
type PostgresDatabase = ReturnType<typeof connectPool>["db"];

/**
 * Like `test`, on a real Postgres (`@repo/testing/postgres`) through the app's postgres.js driver,
 * for what PGlite can't show: password logins as the production roles, several connections.
 * `orm` signs in as `app` and `migratorOrm` as `migrator`; `connect(role)` opens another pool of
 * its own. Every pool closes after the test. Slower than `test`, so use it only when needed.
 */
export const pgTest = createPostgresTest()
  .extend("connect", ({ database }, { onCleanup }) => {
    const pools: (() => Promise<void>)[] = [];
    onCleanup(async () => {
      await Promise.all(pools.map((close) => close()));
    });
    return (role: Role): PostgresDatabase => {
      const { db, close } = connectPool({ url: database.url(role) });
      pools.push(close);
      return db;
    };
  })
  .extend("orm", ({ connect }) => connect("app"))
  .extend("migratorOrm", ({ connect }) => connect("migrator"));
