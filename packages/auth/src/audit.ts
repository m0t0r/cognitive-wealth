import type { Database } from "@repo/db";
import { auditEvent } from "@repo/db/schema";

export type AuditAction =
  | "auth.sign_in"
  | "auth.sign_in_throttled"
  | "auth.sign_out"
  | "auth.sessions_revoked"
  // Written by `pnpm org:deactivate` and `org:reactivate` (`@repo/db`), with no actor.
  | "org.deactivated"
  | "org.reactivated"
  // Written by `cw org export` (`@repo/db`), with no actor.
  | "org.records_exported"
  | "org.invitation.created"
  | "org.invitation.accepted"
  | "org.invitation.declined"
  | "org.invitation.cancelled"
  | "org.member.role_changed"
  | "org.member.removed"
  | "org.switched"
  | "user.profile_updated";

export interface AuditEventInput {
  action: AuditAction;
  actorUserId: number | null;
  organizationId?: number | null;
  /** What the event is about, by publicId (never an internal ID). */
  target?: { type: "user" | "member" | "invitation" | "organization"; publicId: string };
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

/** Longer user agents are cut: the header is client-set, and every request may write one. */
export const MAX_USER_AGENT_LENGTH = 512;

/**
 * Appends an audit event. Never throws: the user's action already happened, so a failed write is
 * logged and swallowed rather than turned into an error for them.
 */
export async function writeAuditEvent(db: Database, event: AuditEventInput): Promise<void> {
  try {
    await db.insert(auditEvent).values({
      action: event.action,
      actorUserId: event.actorUserId,
      organizationId: event.organizationId ?? null,
      targetType: event.target?.type ?? null,
      targetId: event.target?.publicId ?? null,
      ipAddress: event.ipAddress || null,
      userAgent: event.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) || null,
      metadata: event.metadata ?? null,
    });
  } catch (error) {
    console.error(`Failed to write audit event ${event.action}`, error);
  }
}
