import { type Role, createPostgresTest } from "@repo/testing/postgres";
import { connect as connectPool } from "./connect";

// postgres.js's Drizzle type, so `execute` returns rows rather than the shared `Database`'s unknown.
type PostgresDatabase = ReturnType<typeof connectPool>["db"];

/**
 * A `test` whose `orm` fixture is Drizzle over a database of its own on a real Postgres
 * (`@repo/testing/postgres`), through the app's postgres.js driver, signed in with a password as
 * the production roles: `orm` as `app`, `migratorOrm` as `migrator`; `connect(role)` opens
 * another pool of its own, for tests that need several connections. Every pool closes after the
 * test. The package's `vitest.config.ts` names `@repo/db/postgres-setup` as its global setup.
 */
export const test = createPostgresTest()
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
