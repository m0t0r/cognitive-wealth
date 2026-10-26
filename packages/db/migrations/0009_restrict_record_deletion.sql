ALTER TABLE "audit_event" DROP CONSTRAINT "audit_event_organization_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "custodial_position" DROP CONSTRAINT "custodial_position_firm_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "custodial_position" DROP CONSTRAINT "custodial_position_delivery_fk";
--> statement-breakpoint
ALTER TABLE "custodial_transaction" DROP CONSTRAINT "custodial_transaction_firm_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "custodial_transaction" DROP CONSTRAINT "custodial_transaction_delivery_fk";
--> statement-breakpoint
ALTER TABLE "custodian_delivery" DROP CONSTRAINT "custodian_delivery_firm_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "security" DROP CONSTRAINT "security_firm_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "security_price" DROP CONSTRAINT "security_price_firm_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "security_price" DROP CONSTRAINT "security_price_delivery_fk";
--> statement-breakpoint
ALTER TABLE "account_role" DROP CONSTRAINT "account_role_firm_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "custodial_account" DROP CONSTRAINT "custodial_account_firm_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "household" DROP CONSTRAINT "household_firm_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "household_member" DROP CONSTRAINT "household_member_firm_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "person" DROP CONSTRAINT "person_firm_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "world_seed" DROP CONSTRAINT "world_seed_firm_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custodial_position" ADD CONSTRAINT "custodial_position_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custodial_position" ADD CONSTRAINT "custodial_position_delivery_fk" FOREIGN KEY ("firm_id","delivery_id") REFERENCES "public"."custodian_delivery"("firm_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custodial_transaction" ADD CONSTRAINT "custodial_transaction_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custodial_transaction" ADD CONSTRAINT "custodial_transaction_delivery_fk" FOREIGN KEY ("firm_id","delivery_id") REFERENCES "public"."custodian_delivery"("firm_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custodian_delivery" ADD CONSTRAINT "custodian_delivery_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security" ADD CONSTRAINT "security_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_price" ADD CONSTRAINT "security_price_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_price" ADD CONSTRAINT "security_price_delivery_fk" FOREIGN KEY ("firm_id","delivery_id") REFERENCES "public"."custodian_delivery"("firm_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_role" ADD CONSTRAINT "account_role_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custodial_account" ADD CONSTRAINT "custodial_account_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household" ADD CONSTRAINT "household_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_member" ADD CONSTRAINT "household_member_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_seed" ADD CONSTRAINT "world_seed_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;