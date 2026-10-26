// What the `app` role may do to each table, read from the catalog and compared with
// `APP_PRIVILEGES`. `app` gets no default privileges (migration 0008), so a table is closed to it
// until a migration grants it, and this test fails until the table is in the list.
import { randomUUID } from "node:crypto";
import { createDatabase, databaseUrl, dropDatabase } from "@repo/testing/postgres";
import { eq, sql } from "drizzle-orm";
import { APP_PRIVILEGES } from "./app-privileges";
import { connect } from "./connect";
import { withFirm } from "./firm";
import { runMigrations } from "./migrator";
import { custodialAccount, organization, security } from "./schema";
import { test } from "./testing";

// postgres.js's Drizzle type, so `execute` takes the rows' type.
type PostgresDatabase = ReturnType<typeof connect>["db"];
type Granted = { onTable: string[]; columns?: Record<string, string[]> };

/** Every table in `public` with what `app` was granted on it, table-wide and per column. */
async function readAppPrivileges(db: PostgresDatabase): Promise<Record<string, Granted>> {
  const tables = await db.execute<{ table: string; privileges: string[] }>(sql`
    select c.relname::text as table,
      coalesce(
        array_agg(lower(a.privilege_type) order by a.privilege_type)
          filter (where a.privilege_type is not null),
        '{}'
      ) as privileges
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join lateral aclexplode(c.relacl) a on a.grantee = 'app'::regrole
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    group by c.relname
  `);
  const columns = await db.execute<{ table: string; privilege: string; columns: string[] }>(sql`
    select c.relname::text as table, lower(a.privilege_type) as privilege,
      array_agg(att.attname::text order by att.attname) as columns
    from pg_attribute att
    join pg_class c on c.oid = att.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(att.attacl) a
    where n.nspname = 'public' and a.grantee = 'app'::regrole
    group by c.relname, a.privilege_type
  `);

  const result: Record<string, Granted> = {};
  for (const { table, privileges } of tables) result[table] = { onTable: privileges };
  for (const { table, privilege, columns: names } of columns) {
    const entry = result[table]!;
    entry.columns = { ...entry.columns, [privilege]: names };
  }
  return result;
}

/** `APP_PRIVILEGES` in the shape `readAppPrivileges` returns, sorted the same way. */
function declared(): Record<string, Granted> {
  return Object.fromEntries(
    Object.entries(APP_PRIVILEGES).map(([table, { onTable, columns }]) => [
      table,
      {
        onTable: onTable.toSorted(),
        ...(columns && {
          columns: Object.fromEntries(
            Object.entries(columns).map(([privilege, names]) => [privilege, names.toSorted()]),
          ),
        }),
      },
    ]),
  );
}

describe("app's privileges", () => {
  test("are exactly APP_PRIVILEGES", async ({ migratorOrm }) => {
    expect(await readAppPrivileges(migratorOrm)).toEqual(declared());
  });

  // So a table a later migration creates fails the test above until it's granted and listed.
  test("are none on a table a migration creates", async ({ migratorOrm }) => {
    await migratorOrm.execute(sql`create table privileges_probe (id bigint primary key)`);

    expect((await readAppPrivileges(migratorOrm)).privileges_probe).toEqual({ onTable: [] });
  });

  // The dev, worktree and production databases were set up when `01-roles.sh` still gave `app`
  // full DML on every new table by default; migrating one must leave the same privileges.
  test("are exactly APP_PRIVILEGES on a database set up with the old default", async ({
    postgresServer,
    postgresAdmin,
    onTestFinished,
  }) => {
    const name = `${postgresServer.databasePrefix}${randomUUID().replaceAll("-", "")}`;
    await createDatabase(postgresAdmin, { name, template: "template1" });
    onTestFinished(() => dropDatabase(postgresAdmin, { name }));
    const url = databaseUrl({
      serverUrl: postgresServer.url,
      database: name,
      user: { name: "migrator", password: postgresServer.passwords.migrator },
    });
    const { db, close } = connect({ url });
    onTestFinished(close);
    await db.execute(sql`
      alter default privileges for role migrator in schema public
        grant select, insert, update, delete on tables to app
    `);

    await runMigrations({ url });

    expect(await readAppPrivileges(db)).toEqual(declared());
  });
});

const INSUFFICIENT_PRIVILEGE = { cause: { code: "42501" } };

/**
 * The tables whose rows `app` may add but never change or remove, from `APP_PRIVILEGES`.
 * `audit_event` has its own tests and no `firm_id`, which the update below sets.
 */
const APPEND_ONLY_FIRM_TABLES = Object.entries(APP_PRIVILEGES)
  .filter(
    ([table, { onTable, columns }]) =>
      table !== "audit_event" &&
      !columns &&
      !onTable.includes("update") &&
      !onTable.includes("delete"),
  )
  .map(([table]) => table);

// Inside `withFirm`, so it's the privileges that refuse, not row-level security. Postgres checks
// privileges before it looks for rows, so the tables can be empty.
describe("app's writes", () => {
  test.for(APPEND_ONLY_FIRM_TABLES)("can't update %s", async (table, { orm }) => {
    await expect(
      withFirm(orm, {
        firmId: 1,
        query: (tx) => tx.execute(sql`update ${sql.identifier(table)} set firm_id = firm_id`),
      }),
    ).rejects.toMatchObject(INSUFFICIENT_PRIVILEGE);
  });

  test.for([...APPEND_ONLY_FIRM_TABLES, "custodial_account", "security", "world_seed"])(
    "can't delete from %s",
    async (table, { orm }) => {
      await expect(
        withFirm(orm, {
          firmId: 1,
          query: (tx) => tx.execute(sql`delete from ${sql.identifier(table)}`),
        }),
      ).rejects.toMatchObject(INSUFFICIENT_PRIVILEGE);
    },
  );

  test.for([
    { table: "custodial_account", column: "account_number" },
    { table: "security", column: "identifier" },
  ])("can't change $table.$column", async ({ table, column }, { orm }) => {
    await expect(
      withFirm(orm, {
        firmId: 1,
        query: (tx) =>
          tx.execute(sql`update ${sql.identifier(table)} set ${sql.identifier(column)} = 'X'`),
      }),
    ).rejects.toMatchObject(INSUFFICIENT_PRIVILEGE);
  });

  test("can bring an Account's and a Security's details up to date", async ({
    orm,
    migratorOrm,
  }) => {
    const [firm] = await migratorOrm
      .insert(organization)
      .values({ name: "Larkspur", slug: "larkspur" })
      .returning();
    const firmId = firm!.id;
    await migratorOrm.insert(custodialAccount).values({ firmId, accountNumber: "CW-000001" });
    await migratorOrm
      .insert(security)
      .values({ firmId, identifier: "VTI", name: "Total Market", kind: "fund" });

    await withFirm(orm, {
      firmId,
      query: async (tx) => {
        await tx
          .update(custodialAccount)
          .set({ registrationType: "individual", openedOn: "2020-01-02" })
          .where(eq(custodialAccount.firmId, firmId));
        await tx
          .update(security)
          .set({ name: "Total Stock Market" })
          .where(eq(security.firmId, firmId));
      },
    });

    expect(
      await migratorOrm
        .select({ type: custodialAccount.registrationType, openedOn: custodialAccount.openedOn })
        .from(custodialAccount),
    ).toEqual([{ type: "individual", openedOn: "2020-01-02" }]);
    expect(await migratorOrm.select({ name: security.name }).from(security)).toEqual([
      { name: "Total Stock Market" },
    ]);
  });
});
