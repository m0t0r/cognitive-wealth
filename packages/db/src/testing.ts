import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Role, createPostgresTest } from "@repo/testing/postgres";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import journal from "../migrations/meta/_journal.json" with { type: "json" };
import { connect as connectPool } from "./connect";
import { migrationsFolder } from "./migrations-folder";
import { runMigrations } from "./migrator";

// postgres.js's Drizzle type, so `execute` returns rows rather than the shared `Database`'s unknown.
type PostgresDatabase = ReturnType<typeof connectPool>["db"];

/**
 * Applies the migrations up to and including the journal entry tagged `through`. Drizzle's
 * `migrate` only takes a folder and applies its whole journal, so it gets a copy whose journal ends
 * there.
 */
async function migrateThrough(db: PostgresDatabase, { through }: { through: string }) {
  const last = journal.entries.findIndex((entry) => entry.tag === through);
  if (last === -1) throw new Error(`No journal entry tagged ${through}`);
  const folder = await mkdtemp(join(tmpdir(), "migrations-"));
  try {
    await cp(migrationsFolder, folder, { recursive: true });
    await writeFile(
      join(folder, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, last + 1) }),
    );
    await migrate(db, { migrationsFolder: folder });
  } finally {
    await rm(folder, { recursive: true });
  }
}

/**
 * A `test` whose `orm` fixture is Drizzle over a database of its own on a real Postgres
 * (`@repo/testing/postgres`), through the app's postgres.js driver, signed in with a password as
 * the production roles: `orm` as `app`, `migratorOrm` as `migrator`; `connect(role)` opens
 * another pool of its own, for tests that need several connections. Every pool closes after the
 * test. The package's `vitest.config.ts` names `@repo/db/postgres-setup` as its global setup.
 *
 * `migratedThrough(tag)` is for what a migration does to rows that already exist, which the
 * template, migrated while empty, can't show: a database of its own migrated only that far, its
 * `db` signed in as `migrator`, and `migrateRest()` to apply the remaining entries.
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
  .extend("migratorOrm", ({ connect }) => connect("migrator"))
  .extend("migratedThrough", ({ unmigratedDatabase }, { onCleanup }) => {
    const url = unmigratedDatabase.url("migrator");
    const { db, close } = connectPool({ url });
    onCleanup(close);
    return async (through: string) => {
      await migrateThrough(db, { through });
      return { db, migrateRest: () => runMigrations({ url }) };
    };
  });
