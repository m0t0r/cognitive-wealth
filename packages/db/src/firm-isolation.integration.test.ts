// Row-level security on every Firm-scoped table (ADR 0020), checked as `app` with a password login,
// the way the app and the CLIs connect. Rows are written as `migrator`, which owns the tables and so
// isn't held by their policies, so each test starts with both Firms' rows really in the database.
import { inArray, sql } from "drizzle-orm";
import { connect } from "./connect";
import { withFirm } from "./firm";
import { FIRM_SCOPED_TABLES, seedFirm } from "./firm-test-data";
import type { Database } from "./index";
import { custodianDelivery, household, organization, person, worldSeed } from "./schema";
import { test } from "./testing";

const FIRM_NOT_SET = { cause: { code: "42501", message: expect.stringMatching(/^Firm not set/) } };
const RESTRICT_VIOLATION = { cause: { code: "23001" } };
const RLS_VIOLATION = {
  cause: { code: "42501", message: expect.stringMatching(/row-level security policy/) },
};

/** The Firms whose rows a query on `table` sees, with no `where` clause of its own. */
const firmsIn = async (db: Database, table: string) =>
  (
    await db
      .selectDistinct({ firmId: sql<number>`firm_id`.mapWith(Number) })
      .from(sql`${sql.identifier(table)}`)
  ).map((row) => row.firmId);

const isolated = test.extend("firms", async ({ migratorOrm }) => ({
  a: await seedFirm(migratorOrm, "firm-a"),
  b: await seedFirm(migratorOrm, "firm-b"),
}));

describe("Firm isolation", () => {
  isolated(
    "shows a query with no where clause only the set Firm's rows",
    async ({ orm, firms }) => {
      await withFirm(orm, {
        firmId: firms.a,
        query: async (tx) => {
          for (const table of FIRM_SCOPED_TABLES) {
            // oxlint-disable-next-line no-await-in-loop -- one transaction, one connection
            expect({ table, firms: await firmsIn(tx, table) }).toEqual({ table, firms: [firms.a] });
          }
        },
      });
    },
  );

  isolated("refuses an insert into another Firm", async ({ orm, firms }) => {
    await expect(
      withFirm(orm, {
        firmId: firms.a,
        query: (tx) =>
          tx
            .insert(household)
            .values({ firmId: firms.b, name: "Planted", relationshipStatus: "client" }),
      }),
    ).rejects.toMatchObject(RLS_VIOLATION);
  });

  // `app` may update no table's `firm_id` (APP_PRIVILEGES), so this test's own database grants it
  // one, for the policy's check to be what refuses, as it would on a table that ever allows it.
  isolated("refuses moving a row to another Firm", async ({ orm, migratorOrm, firms }) => {
    await migratorOrm.execute(sql`grant update (firm_id) on table world_seed to app`);

    await expect(
      withFirm(orm, {
        firmId: firms.a,
        query: (tx) => tx.update(worldSeed).set({ firmId: firms.b }),
      }),
    ).rejects.toMatchObject(RLS_VIOLATION);
  });

  isolated("refuses a query when no Firm is set", async ({ orm }) => {
    await expect(orm.select().from(household)).rejects.toMatchObject(FIRM_NOT_SET);
    // Even one whose filter matches none of the rows there.
    await expect(
      orm
        .select()
        .from(household)
        .where(sql`${household.name} = ${"Nobody's Household"}`),
    ).rejects.toMatchObject(FIRM_NOT_SET);
  });

  // The policy is checked on each row read, and Postgres also calls `current_firm_id()` while
  // planning, which it does for every query Drizzle sends (none is a reused prepared statement),
  // so a query on empty tables fails too (ADR 0020 says which part is guaranteed).
  test("refuses a query on empty tables when no Firm is set", async ({ orm }) => {
    await expect(orm.select().from(household)).rejects.toMatchObject(FIRM_NOT_SET);
    await expect(
      orm
        .select()
        .from(custodianDelivery)
        .where(sql`${custodianDelivery.firmId} = ${1}`),
    ).rejects.toMatchObject(FIRM_NOT_SET);
    await expect(orm.$count(person)).rejects.toMatchObject(FIRM_NOT_SET);
    // Planning alone calls it.
    await expect(orm.execute(sql`explain select * from household`)).rejects.toMatchObject(
      FIRM_NOT_SET,
    );
  });

  // The limit ADR 0020 records. A query Postgres can prove empty before planning its scan (here
  // `inArray` with no values, which Drizzle writes as `false`) never calls `current_firm_id()`,
  // so it finds nothing rather than failing. Nothing leaks: it could match no row anyway.
  isolated("finds nothing, without an error, when a query can match no row", async ({ orm }) => {
    await expect(orm.select().from(household).where(inArray(household.id, []))).resolves.toEqual(
      [],
    );
  });

  // An insert's check runs on the new row itself, so it fails into an empty table too.
  test("refuses an insert when no Firm is set", async ({ orm }) => {
    const [firm] = await orm.insert(organization).values({ name: "New", slug: "new" }).returning();
    await expect(
      orm.insert(household).values({ firmId: firm!.id, name: "New", relationshipStatus: "client" }),
    ).rejects.toMatchObject(FIRM_NOT_SET);
  });

  isolated(
    "doesn't carry the Firm into the next transaction on a pooled connection",
    async ({ database, firms, onTestFinished }) => {
      // One connection, so the second transaction surely reuses the first one's.
      const { db, close } = connect({ url: database.url("app") }, { max: 1 });
      onTestFinished(close);

      await expect(
        withFirm(db, { firmId: firms.a, query: (tx) => firmsIn(tx, "household") }),
      ).resolves.toEqual([firms.a]);
      // The setting now reads '', not null, on this connection: still not set.
      await expect(
        db.execute(sql`select current_setting('app.firm_id', true) as firm`),
      ).resolves.toEqual([{ firm: "" }]);
      await expect(db.transaction((tx) => firmsIn(tx, "household"))).rejects.toMatchObject(
        FIRM_NOT_SET,
      );
      await expect(firmsIn(db, "household")).rejects.toMatchObject(FIRM_NOT_SET);
    },
  );

  isolated(
    "joins a caller's transaction for the same Firm, and refuses another",
    async ({ orm, firms }) => {
      await withFirm(orm, {
        firmId: firms.a,
        query: async (outer) => {
          await expect(
            withFirm(outer, { firmId: firms.a, query: (tx) => firmsIn(tx, "person") }),
          ).resolves.toEqual([firms.a]);
          await expect(
            withFirm(outer, { firmId: firms.b, query: (tx) => firmsIn(tx, "person") }),
          ).rejects.toMatchObject({
            cause: { message: expect.stringMatching(/already works for Firm/) },
          });
          // Still Firm A's transaction.
          await expect(firmsIn(outer, "person")).resolves.toEqual([firms.a]);
        },
      });
    },
  );

  test("covers every table with a firm_id column with RLS and the app's policy", async ({
    orm,
  }) => {
    const tables = await orm.execute<{ table: string; rls: boolean; policy: boolean }>(sql`
      select c.relname as table,
             c.relrowsecurity as rls,
             exists (
               select from pg_policies p
               where p.schemaname = 'public' and p.tablename = c.relname
                 and p.policyname = 'firm_isolation' and p.cmd = 'ALL' and 'app' = any (p.roles)
             ) as policy
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and a.attname = 'firm_id' and not a.attisdropped
      order by c.relname
    `);
    expect(tables.map((t) => t.table)).toEqual(FIRM_SCOPED_TABLES);
    expect(tables.filter((t) => !t.rls || !t.policy)).toEqual([]);
  });

  // Records are kept (ADR 0021): a Firm with rows can't be deleted, by `app` or by the tables' owner.
  isolated(
    "refuses to delete an organization that has records",
    async ({ orm, migratorOrm, firms }) => {
      for (const db of [orm, migratorOrm]) {
        // oxlint-disable-next-line no-await-in-loop -- one role after the other
        await expect(
          db.delete(organization).where(sql`${organization.id} = ${firms.a}`),
        ).rejects.toMatchObject(RESTRICT_VIOLATION);
      }

      for (const table of FIRM_SCOPED_TABLES) {
        // oxlint-disable-next-line no-await-in-loop -- reads, in order for a readable failure
        const remaining = await firmsIn(migratorOrm, table);
        expect({ table, firms: remaining.toSorted((x, y) => x - y) }).toEqual({
          table,
          firms: [firms.a, firms.b],
        });
      }
    },
  );

  // The test above stops at the first foreign key that refuses; this checks each one.
  test("restricts the deletion of every Firm-scoped table's Firm", async ({ orm }) => {
    const actions = await orm.execute<{ table: string; action: string }>(sql`
      select c.conrelid::regclass::text as table, c.confdeltype as action
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
      where c.contype = 'f' and c.confrelid = 'organization'::regclass and a.attname = 'firm_id'
      order by 1
    `);
    expect(actions.map((a) => a.table)).toEqual(FIRM_SCOPED_TABLES);
    expect(actions.filter((a) => a.action !== "r")).toEqual([]);
  });
});
