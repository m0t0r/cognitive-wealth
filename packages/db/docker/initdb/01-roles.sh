#!/bin/sh
# Runs once, when the Postgres data volume is first initialized. Creates least-privilege roles:
# - `migrator` owns the database and runs DDL (the `migrate` service)
# - `app` can only read and write rows (the `web` service)
# Passwords are read from mounted secrets inside psql, so they never appear in argv or env.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v db="$POSTGRES_DB" <<'SQL'
\set migrator_password `cat /run/secrets/db_migrator_password`
\set app_password `cat /run/secrets/db_app_password`

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
alter default privileges for role migrator in schema public
  grant select, insert, update, delete on tables to app;
alter default privileges for role migrator in schema public
  grant usage, select on sequences to app;
SQL
