#!/bin/sh
# Runs once, when the custodian's Postgres data volume is first initialized. The same split as
# Cognitive Wealth's (packages/db/docker/initdb/01-roles.sh), in a server of its own:
# - `migrator` owns the database and runs DDL (Alembic, `pnpm --filter custodian db:migrate`)
# - `app` reads and writes rows (the custodian service), with only the access each migration grants
# As in Cognitive Wealth's (#190), `app` gets no default privileges: a new table is closed to it
# until its migration grants what it needs, so the append-only Ledger can't be opened by omission.
# Passwords are read from mounted secrets inside psql, so they never appear in argv or env.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v db="$POSTGRES_DB" <<'SQL'
\set migrator_password `cat /run/secrets/custodian_db_migrator_password`
\set app_password `cat /run/secrets/custodian_db_app_password`

create role migrator login password :'migrator_password';
create role app login password :'app_password';

-- Owning the database makes `migrator` the owner of the `public` schema (pg_database_owner).
alter database :"db" owner to migrator;
revoke all on database :"db" from public;
grant connect on database :"db" to app;
-- PUBLIC can otherwise connect to (and create temp tables in) the maintenance databases.
revoke connect, temporary on database postgres from public;
revoke connect, temporary on database template1 from public;

grant usage on schema public to app;
SQL
