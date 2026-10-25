import { sql } from "drizzle-orm";
import journal from "../migrations/meta/_journal.json" with { type: "json" };
import { test } from "./testing";

// As `migrator`: it owns the `drizzle` schema and runs DDL, which `app` can't.
describe("migrations", () => {
  test("apply every journal entry to a fresh database", async ({ migratorOrm }) => {
    const rows = await migratorOrm.execute(
      sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
    );
    expect(rows).toEqual([{ count: journal.entries.length }]);
  });
});

describe("isolation", () => {
  // Both tests create the same table, so whichever runs second fails if they share a database.
  test("gives this test its own database", async ({ migratorOrm }) => {
    await migratorOrm.execute(sql`create table isolation_probe (id uuid primary key)`);
  });

  test("gives that test its own database too", async ({ migratorOrm }) => {
    await migratorOrm.execute(sql`create table isolation_probe (id uuid primary key)`);
  });
});
