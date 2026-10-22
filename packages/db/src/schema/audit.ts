import { bigint, index, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { createdAt, id } from "./_helpers";
import { user } from "./auth";
import { organization } from "./organization";

/**
 * Who did what, where. Append-only for the `app` role (a migration revokes `update` and `delete`);
 * the references are nulled, not cascaded, so events outlive the user or organization.
 */
export const auditEvent = pgTable(
  "audit_event",
  {
    id: id(),
    createdAt: createdAt(),
    // Dotted event name, e.g. `org.member.removed`.
    action: text("action").notNull(),
    actorUserId: bigint("actor_user_id", { mode: "number" }).references(() => user.id, {
      onDelete: "set null",
    }),
    organizationId: bigint("organization_id", { mode: "number" }).references(
      () => organization.id,
      { onDelete: "set null" },
    ),
    targetType: text("target_type"),
    // The target's publicId, so events never hold an internal ID of what they describe.
    targetId: text("target_id"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (t) => [
    index("audit_event_organization_id_created_at_idx").on(t.organizationId, t.createdAt),
    index("audit_event_actor_user_id_idx").on(t.actorUserId),
  ],
);
