CREATE TABLE "account_role_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "account_role_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"record_id" bigint NOT NULL,
	"public_id" uuid NOT NULL,
	"firm_id" bigint NOT NULL,
	"person_id" bigint NOT NULL,
	"account_id" bigint NOT NULL,
	"role" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"operation" text NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"changed_by_user_id" bigint,
	"changed_by_delivery_id" bigint,
	"changed_by_system" text,
	CONSTRAINT "account_role_history_operation_check" CHECK ("account_role_history"."operation" in ('update', 'delete')),
	CONSTRAINT "account_role_history_one_actor_check" CHECK (num_nonnulls("account_role_history"."changed_by_user_id", "account_role_history"."changed_by_delivery_id", "account_role_history"."changed_by_system") = 1)
);
--> statement-breakpoint
ALTER TABLE "account_role_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "household_member_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "household_member_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"record_id" bigint NOT NULL,
	"public_id" uuid NOT NULL,
	"firm_id" bigint NOT NULL,
	"household_id" bigint NOT NULL,
	"person_id" bigint NOT NULL,
	"role" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"operation" text NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"changed_by_user_id" bigint,
	"changed_by_delivery_id" bigint,
	"changed_by_system" text,
	CONSTRAINT "household_member_history_operation_check" CHECK ("household_member_history"."operation" in ('update', 'delete')),
	CONSTRAINT "household_member_history_one_actor_check" CHECK (num_nonnulls("household_member_history"."changed_by_user_id", "household_member_history"."changed_by_delivery_id", "household_member_history"."changed_by_system") = 1)
);
--> statement-breakpoint
ALTER TABLE "household_member_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "household_member" DROP CONSTRAINT "household_member_household_id_person_id_unique";--> statement-breakpoint
ALTER TABLE "account_role" DROP CONSTRAINT "account_role_person_fk";
--> statement-breakpoint
ALTER TABLE "account_role" DROP CONSTRAINT "account_role_account_fk";
--> statement-breakpoint
ALTER TABLE "household_member" DROP CONSTRAINT "household_member_household_fk";
--> statement-breakpoint
ALTER TABLE "household_member" DROP CONSTRAINT "household_member_person_fk";
--> statement-breakpoint
DROP INDEX "household_member_household_id_lead_role_unique";--> statement-breakpoint
ALTER TABLE "account_role" ADD COLUMN "ends_on" date;--> statement-breakpoint
ALTER TABLE "household_member" ADD COLUMN "starts_on" date;--> statement-breakpoint
-- No record says when an existing member joined, so each takes the earliest date that says they
-- were known: their first Account role, or else the day the row was written. `least` ignores a
-- null. Before the history trigger exists, so this writes no versions.
update "household_member" m
set "starts_on" = least(
  m."created_at"::date,
  (select min(r."starts_on") from "account_role" r where r."person_id" = m."person_id")
);
--> statement-breakpoint
ALTER TABLE "household_member" ALTER COLUMN "starts_on" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "household_member" ADD COLUMN "ends_on" date;--> statement-breakpoint
ALTER TABLE "account_role_history" ADD CONSTRAINT "account_role_history_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_role_history" ADD CONSTRAINT "account_role_history_changed_by_user_id_user_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_role_history" ADD CONSTRAINT "account_role_history_changed_by_delivery_fk" FOREIGN KEY ("firm_id","changed_by_delivery_id") REFERENCES "public"."custodian_delivery"("firm_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_member_history" ADD CONSTRAINT "household_member_history_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_member_history" ADD CONSTRAINT "household_member_history_changed_by_user_id_user_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_member_history" ADD CONSTRAINT "household_member_history_changed_by_delivery_fk" FOREIGN KEY ("firm_id","changed_by_delivery_id") REFERENCES "public"."custodian_delivery"("firm_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_role_history_record_id_idx" ON "account_role_history" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "household_member_history_record_id_idx" ON "household_member_history" USING btree ("record_id");--> statement-breakpoint
ALTER TABLE "account_role" ADD CONSTRAINT "account_role_person_fk" FOREIGN KEY ("firm_id","person_id") REFERENCES "public"."person"("firm_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_role" ADD CONSTRAINT "account_role_account_fk" FOREIGN KEY ("firm_id","account_id") REFERENCES "public"."custodial_account"("firm_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_member" ADD CONSTRAINT "household_member_household_fk" FOREIGN KEY ("firm_id","household_id") REFERENCES "public"."household"("firm_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_member" ADD CONSTRAINT "household_member_person_fk" FOREIGN KEY ("firm_id","person_id") REFERENCES "public"."person"("firm_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "household_member_current_person_unique" ON "household_member" USING btree ("household_id","person_id") WHERE "household_member"."ends_on" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "household_member_current_lead_role_unique" ON "household_member" USING btree ("household_id","role") WHERE "household_member"."role" <> 'dependent' and "household_member"."ends_on" is null;--> statement-breakpoint
ALTER TABLE "account_role" ADD CONSTRAINT "account_role_ends_on_check" CHECK ("account_role"."ends_on" >= "account_role"."starts_on");--> statement-breakpoint
ALTER TABLE "household_member" ADD CONSTRAINT "household_member_ends_on_check" CHECK ("household_member"."ends_on" >= "household_member"."starts_on");--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "account_role_history" AS PERMISSIVE FOR ALL TO "app" USING (firm_id = current_firm_id()) WITH CHECK (firm_id = current_firm_id());--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "household_member_history" AS PERMISSIVE FOR ALL TO "app" USING (firm_id = current_firm_id()) WITH CHECK (firm_id = current_firm_id());--> statement-breakpoint
-- A row is ended by setting its end date, never deleted (#192), and each end keeps the old version
-- (ADR 0025), so these join the tables `record_history()` (migration 0012) watches.
create trigger record_history after update or delete on "account_role"
  for each row execute function record_history();
--> statement-breakpoint
create trigger record_history after update or delete on "household_member"
  for each row execute function record_history();
--> statement-breakpoint
-- `app` may change the end date and nothing else, and read history.
grant update (ends_on) on table "account_role", "household_member" to app;
--> statement-breakpoint
grant select on table "account_role_history", "household_member_history" to app;