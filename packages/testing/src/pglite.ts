import { PGlite, type PGliteInterface } from "@electric-sql/pglite";
import { test } from "vitest";

export type Migrate = (db: PGliteInterface) => Promise<void>;

/** Fresh in-memory Postgres. Close it when done. */
export async function createTestDatabase(migrate?: Migrate): Promise<PGliteInterface> {
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
      async ({}, { onCleanup }): Promise<PGliteInterface> => {
        const db = await createTestDatabase(migrate);
        onCleanup(() => db.close());
        return db;
      },
    )
    .extend("db", async ({ templateDb }, { onCleanup }): Promise<PGliteInterface> => {
      const db = await templateDb.clone();
      onCleanup(() => db.close());
      return db;
    });
}
