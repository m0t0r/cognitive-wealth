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

describe("migratedThrough", () => {
  const appliedCount = sql`select count(*)::int as count from drizzle.__drizzle_migrations`;

  test("stops at the named journal entry, and migrateRest applies the others", async ({
    migratedThrough,
  }) => {
    const { db, migrateRest } = await migratedThrough("0012_edit_history");
    const named = journal.entries.findIndex((entry) => entry.tag === "0012_edit_history");
    expect(await db.execute(appliedCount)).toEqual([{ count: named + 1 }]);

    await migrateRest();
    expect(await db.execute(appliedCount)).toEqual([{ count: journal.entries.length }]);
  });

  test("refuses a tag the journal doesn't have", async ({ migratedThrough }) => {
    await expect(migratedThrough("0099_no_such_entry")).rejects.toThrow("0099_no_such_entry");
  });
});

describe("0013_crm_end_dates on existing rows", () => {
  test("gives each member the earlier of their first Account role and the day they were written", async ({
    migratedThrough,
  }) => {
    const { db, migrateRest } = await migratedThrough("0012_edit_history");

    // Raw SQL: src/schema/ already has the columns this migration adds.
    const [firm] = await db.execute<{ id: string }>(
      sql`insert into organization (name, slug) values ('Larkspur', 'larkspur') returning id`,
    );
    const firmId = firm!.id;
    const [home] = await db.execute<{ id: string }>(sql`
      insert into household (firm_id, name, relationship_status)
      values (${firmId}, 'Reyes', 'client') returning id`);
    const [account] = await db.execute<{ id: string }>(sql`
      insert into custodial_account (firm_id, account_number)
      values (${firmId}, 'CW-000001') returning id`);

    const addMember = async ({ firstName, role }: { firstName: string; role: string }) => {
      const [someone] = await db.execute<{ id: string }>(sql`
        insert into person (firm_id, first_name, last_name, born_on)
        values (${firmId}, ${firstName}, 'Reyes', '1980-01-01') returning id`);
      await db.execute(sql`
        insert into household_member (firm_id, household_id, person_id, role, created_at)
        values (${firmId}, ${home!.id}, ${someone!.id}, ${role}, '2026-03-02 12:00:00+00')`);
      return someone!.id;
    };
    const addOwnerRole = ({ personId, startsOn }: { personId: string; startsOn: string }) =>
      db.execute(sql`
        insert into account_role (firm_id, person_id, account_id, role, starts_on)
        values (${firmId}, ${personId}, ${account!.id}, 'owner', ${startsOn})`);

    await addOwnerRole({
      personId: await addMember({ firstName: "Dana", role: "primary" }),
      startsOn: "2020-05-01",
    });
    await addOwnerRole({
      personId: await addMember({ firstName: "Jordan", role: "co_client" }),
      startsOn: "2026-06-01",
    });
    await addMember({ firstName: "Sam", role: "dependent" });

    await migrateRest();

    const members = await db.execute(sql`
      select p.first_name, m.starts_on::text
      from household_member m join person p on p.id = m.person_id
      order by p.first_name`);
    expect(members).toEqual([
      { first_name: "Dana", starts_on: "2020-05-01" },
      { first_name: "Jordan", starts_on: "2026-03-02" },
      { first_name: "Sam", starts_on: "2026-03-02" },
    ]);
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
