import { PGlite } from "@electric-sql/pglite";
import { test } from "vitest";

export type Migrate = (db: PGlite) => Promise<void>;

/** Fresh in-memory Postgres. Close it when done. */
export async function createTestDatabase(migrate?: Migrate): Promise<PGlite> {
  const db = await PGlite.create();
  await migrate?.(db);
  return db;
}

/**
 * A `test` with a `db` fixture: an isolated, migrated in-memory Postgres per test.
 * Migrations run once per worker; each test gets a cheap `clone()` of that template.
 */
export function createDatabaseTest(migrate?: Migrate) {
  return test
    .extend(
      "templateDb",
      { scope: "worker" },
      // Vitest requires a destructuring pattern as the fixture's first argument.
      // oxlint-disable-next-line no-empty-pattern
      async ({}, { onCleanup }): Promise<PGlite> => {
        const db = await createTestDatabase(migrate);
        onCleanup(() => db.close());
        return db;
      },
    )
    .extend("db", async ({ templateDb }, { onCleanup }): Promise<PGlite> => {
      const db = await templateDb.clone();
      // `clone()` is typed as `PGliteInterface` but builds a full `PGlite`, which Drizzle requires.
      if (!(db instanceof PGlite))
        throw new TypeError("Expected PGlite.clone() to return a PGlite");
      onCleanup(() => db.close());
      return db;
    });
}
