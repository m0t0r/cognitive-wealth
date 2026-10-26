// Better Auth's tables: the ones `schema/auth.ts` and `schema/organization.ts` define, read from
// their Drizzle tables rather than written out. `@repo/auth`'s `auth.integration.test.ts` checks
// they're exactly the tables Better Auth's config needs, so an upgrade that changes them fails there.
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as auth from "./schema/auth";
import * as organization from "./schema/organization";

/** Their names in Postgres, sorted. */
export const BETTER_AUTH_TABLES: readonly string[] = Object.values({ ...auth, ...organization })
  .filter((value) => is(value, PgTable))
  .map((table) => getTableName(table))
  .toSorted();
