// Row-level security on every Firm-scoped table (ADR 0020), checked as `app` with a password login,
// the way the app and the CLIs connect. Rows are written as `migrator`, which owns the tables and so
// isn't held by their policies, so each test starts with both Firms' rows really in the database.
import { inArray, sql } from "drizzle-orm";
import { connect } from "./connect";
import { withFirm } from "./firm";
import type { Database } from "./index";
import {
  accountRole,
  custodialAccount,
  custodialPosition,
  custodialTransaction,
  custodianDelivery,
  household,
  householdMember,
  organization,
  person,
  security,
  securityPrice,
  worldSeed,
} from "./schema";
import { test } from "./testing";

/** Every table with a `firm_id` column. The catalog test below fails when one is missing. */
const FIRM_SCOPED_TABLES = [
  "account_role",
  "custodial_account",
  "custodial_position",
  "custodial_transaction",
  "custodian_delivery",
  "household",
  "household_member",
  "person",
  "security",
  "security_price",
  "world_seed",
];

const FIRM_NOT_SET = { cause: { code: "42501", message: expect.stringMatching(/^Firm not set/) } };
const RLS_VIOLATION = {
  cause: { code: "42501", message: expect.stringMatching(/row-level security policy/) },
};

/** One row in every Firm-scoped table for the Firm `slug`, written as the tables' owner. */
async function seedFirm(owner: Database, slug: string): Promise<number> {
  const [firm] = await owner.insert(organization).values({ name: slug, slug }).returning();
  const firmId = firm!.id;
  const [home] = await owner
    .insert(household)
    .values({ firmId, name: `${slug} Household`, relationshipStatus: "client" })
    .returning();
  const [someone] = await owner
    .insert(person)
    .values({ firmId, firstName: "Ada", lastName: slug, bornOn: "1980-01-01" })
    .returning();
  await owner
    .insert(householdMember)
    .values({ firmId, householdId: home!.id, personId: someone!.id, role: "primary" });
  const [account] = await owner
    .insert(custodialAccount)
    .values({ firmId, accountNumber: "CW-000001" })
    .returning();
  await owner.insert(accountRole).values({
    firmId,
    personId: someone!.id,
    accountId: account!.id,
    role: "owner",
    startsOn: "2026-01-01",
  });
  await owner.insert(worldSeed).values({ firmId, worldHash: "0".repeat(64) });
  const [delivery] = await owner
    .insert(custodianDelivery)
    .values({ firmId, asOfDate: "2026-03-02", manifestSha256: "0".repeat(64) })
    .returning();
  const [fund] = await owner
    .insert(security)
    .values({ firmId, identifier: "VTI", name: "Total Market", kind: "fund" })
    .returning();
  const day = { firmId, deliveryId: delivery!.id, securityId: fund!.id };
  await owner.insert(custodialTransaction).values({
    ...day,
    transactionId: "T-1",
    accountId: account!.id,
    kind: "buy",
    shares: "1",
    amount: "-100.00",
    tradeDate: "2026-03-02",
    settlementDate: "2026-03-03",
    postingDate: "2026-03-02",
  });
  await owner.insert(custodialPosition).values({
    ...day,
    asOfDate: "2026-03-02",
    accountId: account!.id,
    shares: "1",
  });
  await owner.insert(securityPrice).values({ ...day, asOfDate: "2026-03-02", price: "100" });
  return firmId;
}

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

  isolated("refuses moving a row to another Firm", async ({ orm, firms }) => {
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

  isolated(
    "still cascades an organization's deletion, with no Firm set",
    async ({ orm, migratorOrm, firms }) => {
      await orm.delete(organization).where(sql`${organization.id} = ${firms.a}`);

      for (const table of FIRM_SCOPED_TABLES) {
        // oxlint-disable-next-line no-await-in-loop -- reads, in order for a readable failure
        expect({ table, firms: await firmsIn(migratorOrm, table) }).toEqual({
          table,
          firms: [firms.b],
        });
      }
    },
  );
});
