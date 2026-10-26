import { sql } from "drizzle-orm";
import type { Database } from "./index";

/**
 * Runs `query` in a transaction that works for the Firm `firmId` (ADR 0020): `set_firm_id()`
 * (migration 0006) sets `app.firm_id`, which every Firm-scoped table's row-level security policy
 * reads, for this transaction only, so a pooled connection never carries it into the next one.
 * Called inside another transaction, it joins it (as a savepoint), and the database refuses one
 * that already works for another Firm.
 *
 * Every domain function that touches a Firm-scoped table goes through it, with the Firm it was
 * given. RLS then catches a query that forgets its Firm filter, not a function handed the wrong
 * Firm, so `firmId` must come from the session's active organization or a CLI's or job's own input.
 */
export async function withFirm<T>(
  db: Database,
  { firmId, query }: { firmId: number; query: (tx: Database) => Promise<T> },
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_firm_id(${firmId})`);
    return query(tx);
  });
}
