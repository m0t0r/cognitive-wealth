// What the `app` role must never be able to do, whatever `APP_PRIVILEGES` and the migrations say.
// `app-privileges.integration.test.ts` checks that the two agree, so a change to both passes it;
// these rules name their tables and natural keys here, or cover every table from the catalog, so
// breaking one means changing this file too, which a reviewer reads as a rule change, not a grant.
// Records are kept safe from alteration and destruction (Rule 204-2(g)(3)(i), #189).
import { sql } from "drizzle-orm";
import type { connect } from "./connect";
import { test } from "./testing";

// postgres.js's Drizzle type, so `execute` takes the rows' type.
type PostgresDatabase = ReturnType<typeof connect>["db"];

/** Rows are added and read, never changed or removed. */
const FACTS = [
  "audit_event",
  "custodian_delivery",
  "custodial_position",
  "custodial_transaction",
  "security_price",
];

/**
 * The Custodian's Accounts and Securities: Ingestion brings their details up to date, but the
 * facts above refer to them, so a row is never removed.
 */
const NEVER_DELETED = [...FACTS, "custodial_account", "security"];

/** The columns that identify a row by the Custodian's or the world's key, besides `id`s. */
const NATURAL_KEYS = [
  { table: "custodial_account", column: "account_number" },
  { table: "custodial_transaction", column: "transaction_id" },
  { table: "security", column: "identifier" },
];

/**
 * Better Auth updates its rows through table-wide `update`, which covers `id` and `public_id`, so
 * the rule on those two covers Cognitive Wealth's own tables only.
 */
const BETTER_AUTH_TABLES = [
  "account",
  "invitation",
  "member",
  "organization",
  "session",
  "user",
  "verification",
];

/** A `text[]` literal; Drizzle would spread a plain array into a list of parameters. */
function textArray(values: string[]) {
  return sql`array[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;
}

/** Every rule `app`'s privileges break in this database, empty when none. */
async function neverRuleBreaches(db: PostgresDatabase): Promise<string[]> {
  // has_any_column_privilege, since has_table_privilege sees only a table-wide `update`.
  const updates = await db.execute<{ breach: string }>(sql`
    select format('app may update %s', t.name) as breach
    from unnest(${textArray(FACTS)}) as t(name)
    where has_any_column_privilege('app', format('public.%I', t.name), 'UPDATE')
  `);
  const deletes = await db.execute<{ breach: string }>(sql`
    select format('app may delete %s', t.name) as breach
    from unnest(${textArray(NEVER_DELETED)}) as t(name)
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
  // migration creates is covered too.
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
  // By name, so a renamed column fails here rather than dropping out of the rule.
  const naturalKeys = await db.execute<{ breach: string }>(sql`
    select format('app may update %s.%s', k.table_name, k.column_name) as breach
    from unnest(
      ${textArray(NATURAL_KEYS.map(({ table }) => table))},
      ${textArray(NATURAL_KEYS.map(({ column }) => column))}
    ) as k(table_name, column_name)
    where has_column_privilege('app', format('public.%I', k.table_name), k.column_name, 'UPDATE')
  `);
  return [...updates, ...deletes, ...truncates, ...identifiers, ...naturalKeys]
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

  test.for(["custodial_account", "security"])(
    "report app deleting from %s",
    async (table, { migratorOrm }) => {
      await migratorOrm.execute(sql`grant delete on table ${sql.identifier(table)} to app`);

      expect(await neverRuleBreaches(migratorOrm)).toEqual([`app may delete ${table}`]);
    },
  );

  test("report app updating any column of a fact table", async ({ migratorOrm }) => {
    await migratorOrm.execute(sql`grant update (shares) on table custodial_position to app`);

    expect(await neverRuleBreaches(migratorOrm)).toEqual(["app may update custodial_position"]);
  });

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
