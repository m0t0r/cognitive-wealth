CREATE TABLE "account_role" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "account_role_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" uuid DEFAULT uuidv7() NOT NULL,
	"firm_id" bigint NOT NULL,
	"person_id" bigint NOT NULL,
	"account_id" bigint NOT NULL,
	"role" text NOT NULL,
	"starts_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_role_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "account_role_person_id_account_id_role_starts_on_unique" UNIQUE("person_id","account_id","role","starts_on"),
	CONSTRAINT "account_role_role_check" CHECK ("account_role"."role" in ('owner', 'joint_owner', 'custodian', 'beneficiary', 'power_of_attorney'))
);
--> statement-breakpoint
CREATE TABLE "custodial_account" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "custodial_account_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" uuid DEFAULT uuidv7() NOT NULL,
	"firm_id" bigint NOT NULL,
	"account_number" text NOT NULL,
	"registration_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custodial_account_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "custodial_account_firm_id_id_unique" UNIQUE("firm_id","id"),
	CONSTRAINT "custodial_account_firm_id_account_number_unique" UNIQUE("firm_id","account_number"),
	CONSTRAINT "custodial_account_registration_type_check" CHECK ("custodial_account"."registration_type" in ('529', 'individual', 'joint', 'traditional_ira', 'roth_ira', 'custodial'))
);
--> statement-breakpoint
CREATE TABLE "household" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "household_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" uuid DEFAULT uuidv7() NOT NULL,
	"firm_id" bigint NOT NULL,
	"seed_key" text,
	"name" text NOT NULL,
	"relationship_status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "household_firm_id_id_unique" UNIQUE("firm_id","id"),
	CONSTRAINT "household_firm_id_seed_key_unique" UNIQUE("firm_id","seed_key"),
	CONSTRAINT "household_relationship_status_check" CHECK ("household"."relationship_status" in ('prospect', 'client', 'former_client'))
);
--> statement-breakpoint
CREATE TABLE "household_member" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "household_member_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" uuid DEFAULT uuidv7() NOT NULL,
	"firm_id" bigint NOT NULL,
	"household_id" bigint NOT NULL,
	"person_id" bigint NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_member_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "household_member_household_id_person_id_unique" UNIQUE("household_id","person_id"),
	CONSTRAINT "household_member_role_check" CHECK ("household_member"."role" in ('primary', 'co_client', 'dependent'))
);
--> statement-breakpoint
CREATE TABLE "person" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "person_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" uuid DEFAULT uuidv7() NOT NULL,
	"firm_id" bigint NOT NULL,
	"seed_key" text,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"born_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "person_firm_id_id_unique" UNIQUE("firm_id","id"),
	CONSTRAINT "person_firm_id_seed_key_unique" UNIQUE("firm_id","seed_key")
);
--> statement-breakpoint
CREATE TABLE "world_seed" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "world_seed_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"firm_id" bigint NOT NULL,
	"world_hash" text NOT NULL,
	"seeded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "world_seed_firm_id_unique" UNIQUE("firm_id")
);
--> statement-breakpoint
ALTER TABLE "account_role" ADD CONSTRAINT "account_role_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_role" ADD CONSTRAINT "account_role_person_fk" FOREIGN KEY ("firm_id","person_id") REFERENCES "public"."person"("firm_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_role" ADD CONSTRAINT "account_role_account_fk" FOREIGN KEY ("firm_id","account_id") REFERENCES "public"."custodial_account"("firm_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custodial_account" ADD CONSTRAINT "custodial_account_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household" ADD CONSTRAINT "household_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_member" ADD CONSTRAINT "household_member_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_member" ADD CONSTRAINT "household_member_household_fk" FOREIGN KEY ("firm_id","household_id") REFERENCES "public"."household"("firm_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_member" ADD CONSTRAINT "household_member_person_fk" FOREIGN KEY ("firm_id","person_id") REFERENCES "public"."person"("firm_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_seed" ADD CONSTRAINT "world_seed_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_role_account_id_idx" ON "account_role" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "household_member_household_id_lead_role_unique" ON "household_member" USING btree ("household_id","role") WHERE "household_member"."role" <> 'dependent';--> statement-breakpoint
CREATE INDEX "household_member_person_id_idx" ON "household_member" USING btree ("person_id");