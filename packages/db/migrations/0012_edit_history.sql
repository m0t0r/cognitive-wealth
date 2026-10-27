CREATE TABLE "custodial_account_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "custodial_account_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"record_id" bigint NOT NULL,
	"public_id" uuid NOT NULL,
	"firm_id" bigint NOT NULL,
	"account_number" text NOT NULL,
	"registration_type" text,
	"opened_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"operation" text NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"changed_by_user_id" bigint,
	"changed_by_delivery_id" bigint,
	"changed_by_system" text,
	CONSTRAINT "custodial_account_history_operation_check" CHECK ("custodial_account_history"."operation" in ('update', 'delete')),
	CONSTRAINT "custodial_account_history_one_actor_check" CHECK (num_nonnulls("custodial_account_history"."changed_by_user_id", "custodial_account_history"."changed_by_delivery_id", "custodial_account_history"."changed_by_system") = 1)
);
--> statement-breakpoint
ALTER TABLE "custodial_account_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "security_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "security_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"record_id" bigint NOT NULL,
	"public_id" uuid NOT NULL,
	"firm_id" bigint NOT NULL,
	"identifier" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"operation" text NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"changed_by_user_id" bigint,
	"changed_by_delivery_id" bigint,
	"changed_by_system" text,
	CONSTRAINT "security_history_operation_check" CHECK ("security_history"."operation" in ('update', 'delete')),
	CONSTRAINT "security_history_one_actor_check" CHECK (num_nonnulls("security_history"."changed_by_user_id", "security_history"."changed_by_delivery_id", "security_history"."changed_by_system") = 1)
);
--> statement-breakpoint
ALTER TABLE "security_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "custodial_account_history" ADD CONSTRAINT "custodial_account_history_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custodial_account_history" ADD CONSTRAINT "custodial_account_history_changed_by_user_id_user_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custodial_account_history" ADD CONSTRAINT "custodial_account_history_changed_by_delivery_fk" FOREIGN KEY ("firm_id","changed_by_delivery_id") REFERENCES "public"."custodian_delivery"("firm_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_history" ADD CONSTRAINT "security_history_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_history" ADD CONSTRAINT "security_history_changed_by_user_id_user_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_history" ADD CONSTRAINT "security_history_changed_by_delivery_fk" FOREIGN KEY ("firm_id","changed_by_delivery_id") REFERENCES "public"."custodian_delivery"("firm_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custodial_account_history_record_id_idx" ON "custodial_account_history" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "security_history_record_id_idx" ON "security_history" USING btree ("record_id");--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "custodial_account_history" AS PERMISSIVE FOR ALL TO "app" USING (firm_id = current_firm_id()) WITH CHECK (firm_id = current_firm_id());--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "security_history" AS PERMISSIVE FOR ALL TO "app" USING (firm_id = current_firm_id()) WITH CHECK (firm_id = current_firm_id());--> statement-breakpoint
-- Keeps the old version of a row in `<table>_history` when it's updated or deleted (ADR 0025), in
-- the same transaction: every column of the old row, its `id` as `record_id`, the change, when it
-- happened and who made it. One function for every table with history, so a new one needs only its
-- history table and a trigger. It copies columns by name, so a history table has all of its
-- table's: the schema builds both from one factory (`src/schema/history.ts`), and
-- `history.integration.test.ts` checks the catalog. `security definer`, owned by `migrator`,
-- since `app` may only read history; `search_path = ''`, so it can't be steered to another table
-- of the same name.
--
-- Who made the change comes from `setActor` (`@repo/db/actor`), which sets one of
-- `app.actor_user_id`, `app.actor_delivery_id` and `app.actor_system` for the transaction. With none
-- set, a change made as `app` fails with `Actor not set`, like `Firm not set`; any other role (say
-- `migrator` in `pnpm db:studio` or a data migration) is recorded by its name. The role is the one
-- the session set, or else the one it signed in as, since in here `current_user` is `migrator`.
--
-- An update that changes no column but `updated_at` writes nothing, though as `app` it still needs
-- an actor. `valid_until` is `now()`, the changing transaction's start, as every row of a Delivery
-- shares its `arrived_at`; two changes to a row in one transaction share it too, in `id` order.
create function record_history() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_id bigint := nullif(pg_catalog.current_setting('app.actor_user_id', true), '')::bigint;
  delivery_id bigint := nullif(pg_catalog.current_setting('app.actor_delivery_id', true), '')::bigint;
  system text := nullif(pg_catalog.current_setting('app.actor_system', true), '');
  invoker text := coalesce(nullif(pg_catalog.current_setting('role'), 'none'), session_user::text);
  copied text;
  copies text;
begin
  if user_id is null and delivery_id is null and system is null then
    if invoker = 'app' then
      raise exception 'Actor not set: call setActor before changing %, which keeps history', tg_table_name
        using errcode = 'insufficient_privilege';
    end if;
    system := invoker;
  end if;
  if tg_op = 'UPDATE'
    and (pg_catalog.to_jsonb(old) - 'updated_at') = (pg_catalog.to_jsonb(new) - 'updated_at') then
    return null;
  end if;
  select
    pg_catalog.string_agg(pg_catalog.quote_ident(a.attname), ', ' order by a.attnum),
    pg_catalog.string_agg('($1).' || pg_catalog.quote_ident(a.attname), ', ' order by a.attnum)
  into copied, copies
  from pg_catalog.pg_attribute a
  where a.attrelid = tg_relid and a.attnum > 0 and not a.attisdropped and a.attname <> 'id';
  execute pg_catalog.format(
    'insert into %I.%I (record_id, %s, operation, valid_until, changed_by_user_id, '
      'changed_by_delivery_id, changed_by_system) '
      'select ($1).id, %s, $2, pg_catalog.now(), $3, $4, $5',
    tg_table_schema, tg_table_name || '_history', copied, copies
  ) using old, pg_catalog.lower(tg_op), user_id, delivery_id, system;
  return null;
end
$$;
--> statement-breakpoint
create trigger record_history after update or delete on "custodial_account"
  for each row execute function record_history();
--> statement-breakpoint
create trigger record_history after update or delete on "security"
  for each row execute function record_history();
--> statement-breakpoint
-- `app` reads history and nothing else: only the trigger writes it.
grant select on table "custodial_account_history", "security_history" to app;
