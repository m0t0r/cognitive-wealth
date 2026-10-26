// Column and constraint helpers shared by the tables Cognitive Wealth owns (households.ts,
// custodian-feed.ts).
import { sql } from "drizzle-orm";
import { bigint, pgPolicy } from "drizzle-orm/pg-core";
import { organization } from "./organization";

/** A check that `column` holds one of `values`, for a text column with a fixed list. */
export const knownValue = (column: unknown, values: readonly string[]) =>
  sql`${column} in (${sql.raw(values.map((value) => `'${value}'`).join(", "))})`;

// Zod types an enum's `options` as a plain array; Drizzle's `enum` wants a non-empty tuple.
export function nonEmpty<T>(values: readonly T[]): readonly [T, ...T[]] {
  const [first, ...rest] = values;
  if (first === undefined) throw new Error("An enum needs at least one value");
  return [first, ...rest];
}

/**
 * The Firm a row belongs to (GLOSSARY.md), so `firm_id` on every domain table. Records are kept
 * (ADR 0021), so a Firm can't be deleted while it has any.
 */
export const firmId = () =>
  bigint("firm_id", { mode: "number" })
    .notNull()
    .references(() => organization.id, { onDelete: "restrict" });

/**
 * Row-level security for a table with `firmId()` (ADR 0020): `app` sees and writes only the rows of
 * the transaction's Firm, `app.firm_id`, which `withFirm` (`@repo/db`) sets. `current_firm_id()`
 * (migration 0006) raises "Firm not set" when it's missing, so a query run outside `withFirm` fails
 * instead of finding nothing. Goes in every Firm-scoped table's extra config; drizzle-kit enables
 * RLS on a table that has a policy.
 */
export const firmIsolation = () =>
  pgPolicy("firm_isolation", {
    as: "permissive",
    for: "all",
    to: "app",
    using: sql`firm_id = current_firm_id()`,
    withCheck: sql`firm_id = current_firm_id()`,
  });
