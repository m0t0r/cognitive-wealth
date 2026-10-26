ALTER TABLE "custodial_position" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "custodial_transaction" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "custodian_delivery" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "security" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "security_price" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account_role" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "custodial_account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "household" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "household_member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "person" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "world_seed" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "custodial_position" AS PERMISSIVE FOR ALL TO "app" USING (firm_id = current_firm_id()) WITH CHECK (firm_id = current_firm_id());--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "custodial_transaction" AS PERMISSIVE FOR ALL TO "app" USING (firm_id = current_firm_id()) WITH CHECK (firm_id = current_firm_id());--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "custodian_delivery" AS PERMISSIVE FOR ALL TO "app" USING (firm_id = current_firm_id()) WITH CHECK (firm_id = current_firm_id());--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "security" AS PERMISSIVE FOR ALL TO "app" USING (firm_id = current_firm_id()) WITH CHECK (firm_id = current_firm_id());--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "security_price" AS PERMISSIVE FOR ALL TO "app" USING (firm_id = current_firm_id()) WITH CHECK (firm_id = current_firm_id());--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "account_role" AS PERMISSIVE FOR ALL TO "app" USING (firm_id = current_firm_id()) WITH CHECK (firm_id = current_firm_id());--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "custodial_account" AS PERMISSIVE FOR ALL TO "app" USING (firm_id = current_firm_id()) WITH CHECK (firm_id = current_firm_id());--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "household" AS PERMISSIVE FOR ALL TO "app" USING (firm_id = current_firm_id()) WITH CHECK (firm_id = current_firm_id());--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "household_member" AS PERMISSIVE FOR ALL TO "app" USING (firm_id = current_firm_id()) WITH CHECK (firm_id = current_firm_id());--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "person" AS PERMISSIVE FOR ALL TO "app" USING (firm_id = current_firm_id()) WITH CHECK (firm_id = current_firm_id());--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "world_seed" AS PERMISSIVE FOR ALL TO "app" USING (firm_id = current_firm_id()) WITH CHECK (firm_id = current_firm_id());