// Better Auth's organization plugin models (no teams, no dynamic roles). Property names are
// Better Auth's field names.
import { bigint, index, pgTable, text, unique } from "drizzle-orm/pg-core";
import { createdAt, id, publicId, timestamptz } from "./_helpers";
// Cycles with `auth.ts` (session → organization); safe because references are lazy.
// oxlint-disable-next-line import/no-cycle
import { user } from "./auth";

export const organization = pgTable("organization", {
  id: id(),
  publicId: publicId(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  // Better Auth stores it as a JSON string.
  metadata: text("metadata"),
  createdAt: createdAt(),
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
  ],
);
