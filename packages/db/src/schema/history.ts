// The earlier versions of rows `app` may update or delete (ADR 0025): each `<table>_history` holds
// a full copy of the old row, as columns that mirror the table's, with the change that replaced it.
// Only the `record_history()` trigger (migration 0012) writes them, as `migrator`; `app` may only
// read them, under the same row-level security as the table they record. An insert writes nothing:
// the current row is the latest version, and its history the ones before it.
//
// The copied columns come from the same factory as the table's own (`custodialAccountColumns`,
// `securityColumns`), so a column added to a table is added to its history in the same generated
// migration: the trigger copies every column by name, and one missing from the history table would
// fail every update. A copy's `id` is `record_id`, since `id` is the history row's own, and no
// foreign key, so a table that allows deletes keeps the history of a row that's gone; its
// `public_id` isn't unique, since every version has it.
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  type PgColumnBuilderBase,
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { firmIsolation, knownValue } from "./_domain";
import { id, timestamptz } from "./_helpers";
import { user } from "./auth";
import { custodianDelivery, securityColumns } from "./custodian-feed";
import { custodialAccountColumns } from "./households";

export const HISTORY_OPERATIONS = ["update", "delete"] as const;

/** What every history table adds to the copy: the change, when it happened and who made it. */
const change = () => ({
  operation: text("operation", { enum: HISTORY_OPERATIONS }).notNull(),
  // When the change happened (Record time, GLOSSARY.md): the changing transaction's start.
  validUntil: timestamptz("valid_until").notNull(),
  // Who made it: exactly one of the three, set by `setActor` (`@repo/db/actor`).
  changedByUserId: bigint("changed_by_user_id", { mode: "number" }).references(
    (): AnyPgColumn => user.id,
    { onDelete: "restrict" },
  ),
  changedByDeliveryId: bigint("changed_by_delivery_id", { mode: "number" }),
  changedBySystem: text("changed_by_system"),
});

/**
 * The history table `name`, holding `copied` (a table's columns besides `id` and `public_id`,
 * from its factory) with the copy's `record_id` and `public_id`, and the change.
 */
const historyTable = <Copied extends Record<string, PgColumnBuilderBase> & { firmId: unknown }>({
  name,
  copied,
}: {
  name: string;
  copied: Copied;
}) =>
  pgTable(
    name,
    {
      id: id(),
      recordId: bigint("record_id", { mode: "number" }).notNull(),
      publicId: uuid("public_id").notNull(),
      ...copied,
      ...change(),
    },
    (t) => [
      firmIsolation(),
      // The Delivery is the Firm's own, and kept while a version names it (ADR 0021).
      foreignKey({
        name: `${name}_changed_by_delivery_fk`,
        columns: [t.firmId, t.changedByDeliveryId],
        foreignColumns: [custodianDelivery.firmId, custodianDelivery.id],
      }).onDelete("restrict"),
      index(`${name}_record_id_idx`).on(t.recordId),
      check(`${name}_operation_check`, knownValue(t.operation, HISTORY_OPERATIONS)),
      check(
        `${name}_one_actor_check`,
        sql`num_nonnulls(${t.changedByUserId}, ${t.changedByDeliveryId}, ${t.changedBySystem}) = 1`,
      ),
    ],
  );

/** `custodial_account`'s earlier versions. */
export const custodialAccountHistory = historyTable({
  name: "custodial_account_history",
  copied: custodialAccountColumns(),
});

/** `security`'s earlier versions. */
export const securityHistory = historyTable({
  name: "security_history",
  copied: securityColumns(),
});
