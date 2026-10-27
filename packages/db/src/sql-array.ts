import { sql } from "drizzle-orm";

/**
 * A Postgres `text[]` of `values`, one parameter each. Interpolated into a `` sql`…` `` template, a
 * JS array becomes a list of parameters (`$1, $2, …`), not one array, so `unnest(${names}::text[])`
 * fails; `unnest(${textArray(names)})` works.
 */
export function textArray(values: readonly string[]) {
  return sql`array[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;
}
