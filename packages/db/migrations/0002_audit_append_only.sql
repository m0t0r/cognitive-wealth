-- Audit events are append-only for the app: it may insert and read them, never change or remove
-- them. Default privileges (docker/initdb/01-roles.sh) grant `app` full DML on new tables, so take
-- `update` and `delete` back here. Databases without an `app` role (PGlite tests) skip this.
do $$
begin
  if exists (select from pg_roles where rolname = 'app') then
    revoke update, delete on table "audit_event" from app;
  end if;
end
$$;
