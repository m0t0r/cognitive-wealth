// Better Auth's core models. Property names are Better Auth's field names, so the Drizzle adapter
// maps them without per-field config.
import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, pgTable, text } from "drizzle-orm/pg-core";
import { bigintString, createdAt, id, publicId, timestamptz, updatedAt } from "./_helpers";
// `session` and `organization.ts` reference each other's tables. The cycle is safe: references are
// lazy (`() => table.id`), so neither module reads the other's exports while it evaluates.
// oxlint-disable-next-line import/no-cycle
import { organization } from "./organization";

export const user = pgTable(
  "user",
  {
    id: id(),
    publicId: publicId(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // Better Auth lowercases emails before writing them; this keeps any other writer honest, so a
  // plain equality lookup (and the unique constraint) is case-insensitive in effect.
  (t) => [check("user_email_lowercase", sql`${t.email} = lower(${t.email})`)],
);

export const session = pgTable(
  "session",
  {
    id: id(),
    token: text("token").notNull().unique(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamptz("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    // A plain string to Better Auth (not a declared reference), so it can't be a number column.
    activeOrganizationId: bigintString("active_organization_id").references(() => organization.id, {
      onDelete: "set null",
    }),
    // The Firm `getViewer` last moved this session off because its membership was gone, until
    // the User is told and it's cleared (ADR 0023). Firms aren't deleted (ADR 0021).
    removedFromOrganizationId: bigintString("removed_from_organization_id").references(
      () => organization.id,
      { onDelete: "set null" },
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: id(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamptz("access_token_expires_at"),
    refreshTokenExpiresAt: timestamptz("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);
