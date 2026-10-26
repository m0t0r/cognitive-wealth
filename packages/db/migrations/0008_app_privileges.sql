-- `app` gets only what a migration grants it (#190), as `APP_PRIVILEGES` (`src/app-privileges.ts`)
-- lists, and `app-privileges.integration.test.ts` checks. Databases set up before this had
-- `migrator`'s default privileges give `app` full DML on every new table (docker/initdb/01-roles.sh
-- no longer does), so take that default back here, then everything it gave, then grant each table.
alter default privileges for role migrator in schema public
  revoke select, insert, update, delete on tables from app;
--> statement-breakpoint
revoke all on all tables in schema public from app;
--> statement-breakpoint
-- Better Auth's tables: it creates, refreshes and deletes sessions, sign-in codes and memberships.
grant select, insert, update, delete on table
  "account", "invitation", "member", "organization", "session", "user", "verification"
  to app;
--> statement-breakpoint
-- Facts, added and read but never changed or removed: the audit log and the Custodian feed.
grant select, insert on table
  "audit_event", "custodian_delivery", "custodial_position", "custodial_transaction",
  "security_price"
  to app;
--> statement-breakpoint
-- Only the seed writes the CRM tables today, and it only inserts.
grant select, insert on table "account_role", "household", "household_member", "person" to app;
--> statement-breakpoint
-- Ingestion brings Account and Security details up to date (#126), never their identifiers; the
-- seed replaces its record of the world file it loaded.
grant select, insert on table "custodial_account", "security", "world_seed" to app;
--> statement-breakpoint
grant update ("registration_type", "opened_on", "updated_at") on table "custodial_account" to app;
--> statement-breakpoint
grant update ("name", "kind", "updated_at") on table "security" to app;
--> statement-breakpoint
grant update ("world_hash", "seeded_at") on table "world_seed" to app;
