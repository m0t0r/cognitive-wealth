import { sql } from "drizzle-orm";
import type { Database } from "./index";

/**
 * Who makes a transaction's changes (ADR 0025): a User, the Delivery Ingestion is loading, or a
 * named system process (such as `seed`). History tables record it beside each old version.
 */
export type Actor = { userId: number } | { deliveryId: number } | { system: string };

/**
 * Sets the actor of the transaction `tx` until it ends, as `withFirm` sets its Firm, for the
 * `record_history()` trigger (migration 0012) to read: `app.actor_user_id`, `app.actor_delivery_id`
 * or `app.actor_system`, the other two cleared, so a second call replaces the first. Call it inside
 * a transaction, before the first update or delete of a table with history: there, a change made as
 * `app` with no actor fails with `Actor not set`. Outside one, the setting would end with this
 * statement.
 *
 * Separate from `withFirm`, since Ingestion's actor is a Delivery it inserts in the transaction.
 */
export async function setActor(tx: Database, actor: Actor): Promise<void> {
  const { userId = "", deliveryId = "", system = "" } = settings(actor);
  await tx.execute(sql`
    select
      pg_catalog.set_config('app.actor_user_id', ${userId}, true),
      pg_catalog.set_config('app.actor_delivery_id', ${deliveryId}, true),
      pg_catalog.set_config('app.actor_system', ${system}, true)
  `);
}

/** The one setting `actor` fills, checked; the other two stay empty. */
function settings(actor: Actor): { userId?: string; deliveryId?: string; system?: string } {
  if ("userId" in actor) return { userId: positiveId(actor.userId) };
  if ("deliveryId" in actor) return { deliveryId: positiveId(actor.deliveryId) };
  const system = actor.system.trim();
  if (system === "") throw new Error("setActor needs a system's name");
  return { system };
}

function positiveId(id: number): string {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`setActor needs an id, not ${id}`);
  return String(id);
}
