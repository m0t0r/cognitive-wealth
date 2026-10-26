-- A removed member's notice (ADR 0023): the Firm `getViewer` moved the session off, until it's
-- cleared. `app` needs no new grant: it holds `select`, `insert`, `update` and `delete` on the
-- whole `session` table (Better Auth's, migration 0008), and table privileges cover a new column.
ALTER TABLE "session" ADD COLUMN "removed_from_organization_id" bigint;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_removed_from_organization_id_organization_id_fk" FOREIGN KEY ("removed_from_organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;
