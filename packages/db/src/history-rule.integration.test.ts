// ADR 0025, point 5: every table `APP_PRIVILEGES` lets `app` update or delete keeps history, so a
// feature that grants a new update (#192, phase 4) fails here until it adds the history table and
// trigger. Read from the list and the catalog, not a list of tables with history, which a new
// table would simply be left out of.
import { sql } from "drizzle-orm";
import { APP_PRIVILEGES, type TablePrivileges } from "./app-privileges";
import { BETTER_AUTH_TABLES } from "./better-auth-tables";
import type { connect } from "./connect";
import { textArray } from "./sql-array";
import { test } from "./testing";

// postgres.js's Drizzle type, so `execute` takes the rows' type.
type PostgresDatabase = ReturnType<typeof connect>["db"];

/** Tables `app` may update or delete that keep no history, each with why. */
const NO_HISTORY: Record<string, string> = {
  world_seed: "The seed's note of the world file it loaded: bookkeeping, not a record.",
  ...Object.fromEntries(
    BETTER_AUTH_TABLES.map((table) => [
      table,
      "Better Auth's: sessions and sign-in codes churn by design, and membership and organization " +
        "changes already go to audit_event.",
    ]),
  ),
};

/** The tables `privileges` lets `app` update or delete, besides `NO_HISTORY`'s. */
function changeable(privileges: Record<string, TablePrivileges>): string[] {
  return Object.entries(privileges)
    .filter(
      ([table, { onTable, columns }]) =>
        !(table in NO_HISTORY) &&
        (onTable.includes("update") ||
          onTable.includes("delete") ||
          (columns?.update?.length ?? 0) > 0 ||
          (columns?.delete?.length ?? 0) > 0),
    )
    .map(([table]) => table);
}

/**
 * Every way a table `privileges` lets `app` change falls short of history, empty when none: no
 * `<table>_history`, no `record_history()` trigger after each row's update and delete, or a column
 * the history table lacks, which the trigger, copying by name, would fail every change on.
 */
async function historyRuleBreaches(
  db: PostgresDatabase,
  privileges: Record<string, TablePrivileges> = APP_PRIVILEGES,
): Promise<string[]> {
  const tables = textArray(changeable(privileges));
  // pg_trigger.tgtype's bits: 1 for each row, 2 before, 8 delete, 16 update.
  const breaches = await db.execute<{ breach: string }>(sql`
    select format('%s has no history table', t.name) as breach
    from unnest(${tables}) as t(name)
    where to_regclass(format('public.%I', t.name || '_history')) is null
    union all
    select format('%s has no record_history trigger after update and delete', t.name)
    from unnest(${tables}) as t(name)
    where not exists (
      select from pg_trigger g
      where g.tgrelid = to_regclass(format('public.%I', t.name))
        and g.tgfoid = 'public.record_history'::regproc
        and g.tgenabled <> 'D'
        and (g.tgtype & 1) = 1 and (g.tgtype & 2) = 0
        and (g.tgtype & 8) = 8 and (g.tgtype & 16) = 16
    )
    union all
    select format('%s_history has no %s %s', t.name, a.attname, format_type(a.atttypid, a.atttypmod))
    from unnest(${tables}) as t(name)
    join pg_attribute a on a.attrelid = to_regclass(format('public.%I', t.name))
    where a.attnum > 0 and not a.attisdropped and a.attname <> 'id'
      and to_regclass(format('public.%I', t.name || '_history')) is not null
      and not exists (
        select from pg_attribute h
        where h.attrelid = to_regclass(format('public.%I', t.name || '_history'))
          and h.attname = a.attname and not h.attisdropped
          and h.atttypid = a.atttypid and h.atttypmod = a.atttypmod
      )
  `);
  return breaches.map(({ breach }) => breach).toSorted();
}

/** `APP_PRIVILEGES` with a `probe` table whose `name` `app` may update. */
const WITH_PROBE = {
  ...APP_PRIVILEGES,
  probe: { onTable: ["select"], columns: { update: ["name"] } },
} satisfies Record<string, TablePrivileges>;

describe("every table app may update or delete", () => {
  test("keeps history on the migrated database", async ({ migratorOrm }) => {
    expect(changeable(APP_PRIVILEGES).toSorted()).toEqual(["custodial_account", "security"]);
    expect(await historyRuleBreaches(migratorOrm)).toEqual([]);
  });

  test("is reported until it has a history table and trigger", async ({ migratorOrm }) => {
    await migratorOrm.execute(sql`create table probe (id bigint primary key, name text)`);

    expect(await historyRuleBreaches(migratorOrm, WITH_PROBE)).toEqual([
      "probe has no history table",
      "probe has no record_history trigger after update and delete",
    ]);
  });

  test("passes once it has them", async ({ migratorOrm }) => {
    await migratorOrm.execute(sql`create table probe (id bigint primary key, name text)`);
    await migratorOrm.execute(sql`
      create table probe_history (
        id bigint primary key generated always as identity, record_id bigint not null, name text,
        operation text not null, valid_until timestamptz not null, changed_by_user_id bigint,
        changed_by_delivery_id bigint, changed_by_system text
      )
    `);
    await migratorOrm.execute(sql`
      create trigger record_history after update or delete on probe
        for each row execute function record_history()
    `);

    expect(await historyRuleBreaches(migratorOrm, WITH_PROBE)).toEqual([]);
  });

  // A migration written by hand, not from the schema, which adds a column to both (history.ts).
  test("is reported when its history table lacks one of its columns", async ({ migratorOrm }) => {
    await migratorOrm.execute(sql`alter table security add column cusip varchar(9)`);

    expect(await historyRuleBreaches(migratorOrm)).toEqual([
      "security_history has no cusip character varying(9)",
    ]);
  });
});
