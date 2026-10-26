// Better Auth's organization plugin models (no teams, no dynamic roles). Property names are
// Better Auth's field names.
import { sql } from "drizzle-orm";
import { bigint, check, index, pgTable, text, unique } from "drizzle-orm/pg-core";
import { createdAt, id, publicId, timestamptz } from "./_helpers";
// Cycles with `auth.ts` (session → organization); safe because references are lazy.
// oxlint-disable-next-line import/no-cycle
import { user } from "./auth";

// One role per row, from `@repo/auth/access` (`ROLES`). Better Auth itself would store a
// comma-separated list ("owner,admin") if asked; `@repo/auth` never asks, and this makes sure no
// other writer does either.
const knownRole = (column: unknown) => sql`${column} in ('owner', 'admin', 'member')`;

export const organization = pgTable("organization", {
  id: id(),
  publicId: publicId(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  // Better Auth stores it as a JSON string.
  metadata: text("metadata"),
  createdAt: createdAt(),
  // Set while the Firm is deactivated (ADR 0022): no User can act in it. Who did it and why are in
  // its `org.deactivated` audit event. Not one of Better Auth's fields, so it never sees it.
  deactivatedAt: timestamptz("deactivated_at"),
});

export const member = pgTable(
  "member",
  {
    id: id(),
    publicId: publicId(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [
    // Also serves lookups by organization; user_id needs its own index.
    unique("member_organization_id_user_id_unique").on(t.organizationId, t.userId),
    index("member_user_id_idx").on(t.userId),
    check("member_role_check", knownRole(t.role)),
  ],
);

export const invitation = pgTable(
  "invitation",
  {
    id: id(),
    publicId: publicId(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamptz("expires_at").notNull(),
    createdAt: createdAt(),
    inviterId: bigint("inviter_id", { mode: "number" })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [
    index("invitation_organization_id_idx").on(t.organizationId),
    index("invitation_email_idx").on(t.email),
    check("invitation_role_check", knownRole(t.role)),
  ],
);
