-- A Deactivated Firm (ADR 0022): set by `pnpm org:deactivate`, cleared by `pnpm org:reactivate`.
-- `app` needs no new grant: it holds `select`, `insert` and `update` on the whole `organization`
-- table (Better Auth's, migration 0008), and table privileges cover a new column.
ALTER TABLE "organization" ADD COLUMN "deactivated_at" timestamp with time zone;
