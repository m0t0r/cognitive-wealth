CREATE TABLE "custodial_position" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "custodial_position_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" uuid DEFAULT uuidv7() NOT NULL,
	"firm_id" bigint NOT NULL,
	"delivery_id" bigint NOT NULL,
	"as_of_date" date NOT NULL,
	"account_id" bigint NOT NULL,
	"security_id" bigint NOT NULL,
	"shares" numeric(24, 6) NOT NULL,
	"price" numeric,
	"market_value" numeric(20, 2),
	"arrived_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custodial_position_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "custodial_position_account_id_security_id_as_of_date_unique" UNIQUE("account_id","security_id","as_of_date")
);
--> statement-breakpoint
CREATE TABLE "custodial_transaction" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "custodial_transaction_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" uuid DEFAULT uuidv7() NOT NULL,
	"firm_id" bigint NOT NULL,
	"delivery_id" bigint NOT NULL,
	"transaction_id" text NOT NULL,
	"account_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"reverses" text,
	"security_id" bigint,
	"shares" numeric(24, 6),
	"amount" numeric(20, 2) NOT NULL,
	"trade_date" date NOT NULL,
	"settlement_date" date NOT NULL,
	"posting_date" date NOT NULL,
	"arrived_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custodial_transaction_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "custodial_transaction_firm_id_transaction_id_unique" UNIQUE("firm_id","transaction_id"),
	CONSTRAINT "custodial_transaction_kind_check" CHECK ("custodial_transaction"."kind" in ('contribution', 'withdrawal', 'buy', 'sell', 'dividend', 'interest', 'fee', 'transfer', 'reversal'))
);
--> statement-breakpoint
CREATE TABLE "custodian_delivery" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "custodian_delivery_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"firm_id" bigint NOT NULL,
	"as_of_date" date NOT NULL,
	"manifest_sha256" text NOT NULL,
	"arrived_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custodian_delivery_firm_id_id_unique" UNIQUE("firm_id","id"),
	CONSTRAINT "custodian_delivery_firm_id_as_of_date_unique" UNIQUE("firm_id","as_of_date")
);
--> statement-breakpoint
CREATE TABLE "security" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "security_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" uuid DEFAULT uuidv7() NOT NULL,
	"firm_id" bigint NOT NULL,
	"identifier" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "security_firm_id_id_unique" UNIQUE("firm_id","id"),
	CONSTRAINT "security_firm_id_identifier_unique" UNIQUE("firm_id","identifier"),
	CONSTRAINT "security_kind_check" CHECK ("security"."kind" in ('stock', 'fund', 'bond', 'cash_sweep'))
);
--> statement-breakpoint
CREATE TABLE "security_price" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "security_price_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"firm_id" bigint NOT NULL,
	"delivery_id" bigint NOT NULL,
	"as_of_date" date NOT NULL,
	"security_id" bigint NOT NULL,
	"price" numeric NOT NULL,
	"arrived_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_price_security_id_as_of_date_unique" UNIQUE("security_id","as_of_date")
);
--> statement-breakpoint
ALTER TABLE "custodial_account" ADD COLUMN "opened_on" date;--> statement-breakpoint
ALTER TABLE "custodial_position" ADD CONSTRAINT "custodial_position_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custodial_position" ADD CONSTRAINT "custodial_position_delivery_fk" FOREIGN KEY ("firm_id","delivery_id") REFERENCES "public"."custodian_delivery"("firm_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custodial_position" ADD CONSTRAINT "custodial_position_account_fk" FOREIGN KEY ("firm_id","account_id") REFERENCES "public"."custodial_account"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custodial_position" ADD CONSTRAINT "custodial_position_security_fk" FOREIGN KEY ("firm_id","security_id") REFERENCES "public"."security"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custodial_transaction" ADD CONSTRAINT "custodial_transaction_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custodial_transaction" ADD CONSTRAINT "custodial_transaction_delivery_fk" FOREIGN KEY ("firm_id","delivery_id") REFERENCES "public"."custodian_delivery"("firm_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custodial_transaction" ADD CONSTRAINT "custodial_transaction_account_fk" FOREIGN KEY ("firm_id","account_id") REFERENCES "public"."custodial_account"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custodial_transaction" ADD CONSTRAINT "custodial_transaction_security_fk" FOREIGN KEY ("firm_id","security_id") REFERENCES "public"."security"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custodian_delivery" ADD CONSTRAINT "custodian_delivery_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security" ADD CONSTRAINT "security_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_price" ADD CONSTRAINT "security_price_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_price" ADD CONSTRAINT "security_price_delivery_fk" FOREIGN KEY ("firm_id","delivery_id") REFERENCES "public"."custodian_delivery"("firm_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_price" ADD CONSTRAINT "security_price_security_fk" FOREIGN KEY ("firm_id","security_id") REFERENCES "public"."security"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custodial_position_delivery_id_idx" ON "custodial_position" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "custodial_transaction_account_id_trade_date_idx" ON "custodial_transaction" USING btree ("account_id","trade_date");--> statement-breakpoint
CREATE INDEX "custodial_transaction_delivery_id_idx" ON "custodial_transaction" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "security_price_delivery_id_idx" ON "security_price" USING btree ("delivery_id");