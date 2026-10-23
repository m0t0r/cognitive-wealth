-- One known role per member and invitation (`@repo/auth/access` ROLES). Better Auth stores a
-- comma-separated list when asked for several roles; nothing may write one.
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_role_check" CHECK ("invitation"."role" in ('owner', 'admin', 'member'));--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_role_check" CHECK ("member"."role" in ('owner', 'admin', 'member'));