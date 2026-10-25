// Column and constraint helpers shared by the tables Cognitive Wealth owns (households.ts,
// custodian-feed.ts).
import { sql } from "drizzle-orm";
import { bigint } from "drizzle-orm/pg-core";
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

/** The Firm a row belongs to (GLOSSARY.md), so `firm_id` on every domain table. */
export const firmId = () =>
  bigint("firm_id", { mode: "number" })
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" });
