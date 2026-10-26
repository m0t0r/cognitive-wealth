import { eq, sql } from "drizzle-orm";
import type { Database } from "./index";
import { organization } from "./schema/organization";

/**
 * `withFirm` was handed a Deactivated Firm (ADR 0022), whose records no domain path may read or
 * write. Thrown before `query` runs, so nothing was read or written; unlike `Firm not set`, which
 * is a database error, callers can tell it apart with `instanceof`.
 */
export class FirmDeactivatedError extends Error {
  override name = "FirmDeactivatedError";
  readonly firmId: number;
  constructor(firmId: number) {
    super(`Firm ${firmId} is deactivated: its records can't be read or written`);
    this.firmId = firmId;
  }
}

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
 *
 * A Deactivated Firm is refused with `FirmDeactivatedError`, reads included, so no caller reaches
 * its records whether or not it checked (ADR 0022). A deactivation that commits while `query` runs
 * takes hold from the next transaction.
 */
export async function withFirm<T>(
  db: Database,
  { firmId, query }: { firmId: number; query: (tx: Database) => Promise<T> },
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_firm_id(${firmId})`);
    const [firm] = await tx
      .select({ deactivatedAt: organization.deactivatedAt })
      .from(organization)
      .where(eq(organization.id, firmId));
    if (firm?.deactivatedAt) throw new FirmDeactivatedError(firmId);
    return query(tx);
  });
}
