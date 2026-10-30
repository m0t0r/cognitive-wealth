// What the `app` role must never be able to do, whatever `APP_PRIVILEGES` and the migrations say.
// `app-privileges.integration.test.ts` checks that the two agree, so a change to both passes it;
// these rules name their tables and natural keys here, or cover every table from the catalog, so
// breaking one means changing this file too, which a reviewer reads as a rule change, not a grant.
// Records are kept safe from alteration and destruction (Rule 204-2(g)(3)(i), #189).
//
// The names are the schema's Drizzle tables and columns, not strings: dropping or renaming one in
// `src/schema/` fails type checking here, and a changed SQL name follows the schema.
import { getTableColumns, getTableName, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { setActor } from "./actor";
import { BETTER_AUTH_TABLES } from "./better-auth-tables";
import type { connect } from "./connect";
import { withFirm } from "./firm";
import { seedFirm } from "./firm-test-data";
import {
  accountRole,
  accountRoleHistory,
  auditEvent,
  custodialAccount,
  custodialAccountHistory,
  custodialPosition,
  custodialTransaction,
  custodianDelivery,
  household,
  householdMember,
  householdMemberHistory,
  person,
  security,
  securityHistory,
  securityPrice,
  worldSeed,
} from "./schema";
import { textArray } from "./sql-array";
import { test } from "./testing";

// postgres.js's Drizzle type, so `execute` takes the rows' type.
type PostgresDatabase = ReturnType<typeof connect>["db"];

const INSUFFICIENT_PRIVILEGE = { cause: { code: "42501" } };

/** Rows are added and read, never changed or removed. */
const FACTS: PgTable[] = [
  auditEvent,
  custodianDelivery,
  custodialPosition,
  custodialTransaction,
  securityPrice,
];

/**
 * The Custodian's Accounts and Securities: Ingestion brings their details up to date, but the
 * facts above refer to them, so a row is never removed.
 */
const CUSTODIAN_RECORDS: PgTable[] = [custodialAccount, security];

/**
 * The CRM: a membership or an Account role is ended with its end date and a Household stays as a
 * Former client, so a row is never removed (#192), a Prospect's that never signed included.
 */
const CRM: PgTable[] = [accountRole, household, householdMember, person];

/**
 * Earlier versions of rows (ADR 0025), which only the `record_history()` trigger writes, so `app`
 * can neither skip a version nor edit or delete one.
 */
const HISTORY: PgTable[] = [
  accountRoleHistory,
  custodialAccountHistory,
  householdMemberHistory,
  securityHistory,
];

const NEVER_UPDATED: PgTable[] = [...FACTS, ...HISTORY];
const NEVER_DELETED: PgTable[] = [...FACTS, ...CUSTODIAN_RECORDS, ...CRM, ...HISTORY];

/**
 * Cognitive Wealth's own tables whose rows `app` may change or remove, as far as its grants allow:
 * the seed's record of the world file it loaded.
 */
const MAY_CHANGE: PgTable[] = [worldSeed];

/**
 * Every table in `public` belongs to exactly one, so a new one fails until it's sorted: a fact a
 * migration adds doesn't get past these rules by never being listed.
 */
const GROUPS: Record<string, readonly string[]> = {
  facts: tableNames(FACTS),
  "Custodian records": tableNames(CUSTODIAN_RECORDS),
  CRM: tableNames(CRM),
  history: tableNames(HISTORY),
  "Better Auth": BETTER_AUTH_TABLES,
  "may change": tableNames(MAY_CHANGE),
};

/** The columns that identify a row by the Custodian's or the world's key, besides `id`s. */
const NATURAL_KEYS: PgColumn[] = [
  custodialAccount.accountNumber,
  custodialTransaction.transactionId,
  security.identifier,
];

/** Their names in Postgres. */
function tableNames(tables: PgTable[]) {
  return tables.map((table) => getTableName(table));
}

/** Every table in `public` that's in no group or in several, empty when each is in one. */
async function unsortedTables(db: PostgresDatabase): Promise<string[]> {
  const tables = await db.execute<{ name: string }>(sql`
    select c.relname::text as name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    order by c.relname
  `);
  return tables.flatMap(({ name }) => {
    const groups = Object.keys(GROUPS).filter((group) => GROUPS[group]!.includes(name));
    if (groups.length === 0) return [`${name} is in no group`];
    if (groups.length > 1) return [`${name} is in ${groups.join(" and ")}`];
    return [];
  });
}

/** Every rule `app`'s privileges break in this database, empty when none. */
async function neverRuleBreaches(db: PostgresDatabase): Promise<string[]> {
  // has_any_column_privilege, since has_table_privilege sees only a table-wide `update`.
  const updates = await db.execute<{ breach: string }>(sql`
    select format('app may update %s', t.name) as breach
    from unnest(${textArray(tableNames(NEVER_UPDATED))}) as t(name)
    where has_any_column_privilege('app', format('public.%I', t.name), 'UPDATE')
  `);
  const inserts = await db.execute<{ breach: string }>(sql`
    select format('app may insert into %s', t.name) as breach
    from unnest(${textArray(tableNames(HISTORY))}) as t(name)
    where has_any_column_privilege('app', format('public.%I', t.name), 'INSERT')
  `);
  const deletes = await db.execute<{ breach: string }>(sql`
    select format('app may delete %s', t.name) as breach
    from unnest(${textArray(tableNames(NEVER_DELETED))}) as t(name)
    where has_table_privilege('app', format('public.%I', t.name), 'DELETE')
  `);
  // Every table, so one a later migration creates is covered too.
  const truncates = await db.execute<{ breach: string }>(sql`
    select format('app may truncate %s', c.relname) as breach
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and has_table_privilege('app', c.oid, 'TRUNCATE')
  `);
  // Every `firm_id`, and every `id` and `public_id` off Better Auth's tables, so a table a later
  // migration creates is covered too. Better Auth updates its rows through table-wide `update`,
  // which covers those two, so they hold on Cognitive Wealth's own tables only.
  const identifiers = await db.execute<{ breach: string }>(sql`
    select format('app may update %s.%s', c.relname, a.attname) as breach
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0
      and not a.attisdropped
      and (a.attname = 'firm_id'
        or (a.attname in ('id', 'public_id')
          and c.relname <> all(${textArray(BETTER_AUTH_TABLES)})))
      and has_column_privilege('app', c.oid, a.attnum, 'UPDATE')
  `);
  // A column the schema has but the database doesn't makes has_column_privilege throw.
  const naturalKeys = await db.execute<{ breach: string }>(sql`
    select format('app may update %s.%s', k.table_name, k.column_name) as breach
    from unnest(
      ${textArray(tableNames(NATURAL_KEYS.map(({ table }) => table)))},
      ${textArray(NATURAL_KEYS.map(({ name }) => name))}
    ) as k(table_name, column_name)
    where has_column_privilege('app', format('public.%I', k.table_name), k.column_name, 'UPDATE')
  `);
  return [...updates, ...inserts, ...deletes, ...truncates, ...identifiers, ...naturalKeys]
    .map(({ breach }) => breach)
    .toSorted();
}

describe("app's never-rules", () => {
  test("hold on the migrated database", async ({ migratorOrm }) => {
    expect(await neverRuleBreaches(migratorOrm)).toEqual([]);
  });

  test("report app deleting from a fact table", async ({ migratorOrm }) => {
    await migratorOrm.execute(sql`grant delete on table custodial_transaction to app`);

    expect(await neverRuleBreaches(migratorOrm)).toEqual(["app may delete custodial_transaction"]);
  });

  test.for([
    "custodial_account",
    "security",
    "household",
    "person",
    "household_member",
    "account_role",
  ])("report app deleting from %s", async (table, { migratorOrm }) => {
    await migratorOrm.execute(sql`grant delete on table ${sql.identifier(table)} to app`);

    expect(await neverRuleBreaches(migratorOrm)).toEqual([`app may delete ${table}`]);
  });

  test("report app updating any column of a fact table", async ({ migratorOrm }) => {
    await migratorOrm.execute(sql`grant update (shares) on table custodial_position to app`);

    expect(await neverRuleBreaches(migratorOrm)).toEqual(["app may update custodial_position"]);
  });

  // A single column for `update`, since a table-wide one also breaks the identifier rules.
  test.for([
    ["insert into", sql`grant insert on table security_history to app`],
    ["update", sql`grant update (name) on table security_history to app`],
    ["delete", sql`grant delete on table security_history to app`],
  ] as const)(
    "report app being able to %s a history table",
    async ([verb, grant], { migratorOrm }) => {
      await migratorOrm.execute(grant);

      expect(await neverRuleBreaches(migratorOrm)).toEqual([`app may ${verb} security_history`]);
    },
  );

  test("report app updating a column that identifies a row", async ({ migratorOrm }) => {
    await migratorOrm.execute(sql`grant update (identifier) on table security to app`);

    expect(await neverRuleBreaches(migratorOrm)).toEqual(["app may update security.identifier"]);
  });

  test("report app updating a column that identifies a row's Firm", async ({ migratorOrm }) => {
    await migratorOrm.execute(sql`grant update (firm_id) on table household to app`);

    expect(await neverRuleBreaches(migratorOrm)).toEqual(["app may update household.firm_id"]);
  });

  test("report app truncating any table", async ({ migratorOrm }) => {
    await migratorOrm.execute(sql`grant truncate on table session to app`);

    expect(await neverRuleBreaches(migratorOrm)).toEqual(["app may truncate session"]);
  });
});

// The rules above read the catalog; these are what `app` gets when it tries, inside its Firm.
describe("app on the CRM tables", () => {
  const firm = test.extend("firmId", ({ migratorOrm }) => seedFirm(migratorOrm, "larkspur"));

  firm.for(["household", "person", "household_member", "account_role"])(
    "can't delete from %s",
    async (table, { orm, firmId }) => {
      await expect(
        withFirm(orm, {
          firmId,
          query: (tx) => tx.execute(sql`delete from ${sql.identifier(table)}`),
        }),
      ).rejects.toMatchObject(INSUFFICIENT_PRIVILEGE);
    },
  );

  // Every column but `ends_on`, read from the schema, so a later column is covered too. `default`,
  // the one value Postgres takes for every column, `id` included, so only the grant can refuse it.
  const OTHER_COLUMNS = [accountRole, householdMember].flatMap((table) =>
    Object.values(getTableColumns(table))
      .filter(({ name }) => name !== "ends_on")
      .map(({ name }) => [getTableName(table), name] as const),
  );

  firm.for(OTHER_COLUMNS)("can't update %s.%s", async ([table, column], { orm, firmId }) => {
    await expect(
      withFirm(orm, {
        firmId,
        query: async (tx) => {
          await setActor(tx, { system: "test" });
          await tx.execute(
            sql`update ${sql.identifier(table)} set ${sql.identifier(column)} = default`,
          );
        },
      }),
    ).rejects.toMatchObject(INSUFFICIENT_PRIVILEGE);
  });
});

describe("the tables' groups", () => {
  test("hold every table on the migrated database, each once", async ({ migratorOrm }) => {
    expect(await unsortedTables(migratorOrm)).toEqual([]);
  });

  test("report a table a migration creates until it's sorted", async ({ migratorOrm }) => {
    await migratorOrm.execute(sql`create table custodial_lot (id bigint primary key)`);

    expect(await unsortedTables(migratorOrm)).toEqual(["custodial_lot is in no group"]);
  });
});
