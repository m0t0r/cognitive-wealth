// The server-side tenant and session API (ADR 0001, "Tenant and session API"). Framework-agnostic:
// `getViewer`/`requireTenant` and every mutation take the request `Headers`; `apps/web` adapts it
// to `next/headers`.
//
// Rules:
// - Reads take a viewer from `getViewer`/`requireTenant` (one session lookup per request) and use
//   Drizzle builders scoped to the organization that viewer is verified to belong to.
// - Mutations go through `auth.api.*`, so Better Auth's permission checks apply; input publicIds
//   are resolved to internal IDs only within the viewer's tenant (or, for invitations addressed
//   to the viewer, after Better Auth's recipient check).
// - Tenant mutations also take the `organizationPublicId` of the workspace the page showed, and
//   refuse with `tenant_changed` when the session has since switched to another one (a second
//   tab), so a stale page can never act on a workspace its user isn't looking at.
// - Results are `{ ok: true, data } | { ok: false, error }` with DTOs that carry no internal ID.
import type { Database } from "@repo/db";
import { invitation, member, organization, user } from "@repo/db/schema";
import { getIP, isAPIError } from "better-auth/api";
import { and, asc, desc, eq, gt, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import * as z from "zod";
import { ROLES, type Role } from "./access";
import { writeAuditEvent, type AuditEventInput } from "./audit";
import { SESSION_FRESH_AGE, type Auth } from "./auth";
import {
  toPublicInvitation,
  toPublicMember,
  toPublicMembership,
  toPublicOrganization,
  toPublicUser,
  toRole,
  type InvitationStatus,
  type PublicInvitation,
  type PublicMember,
  type PublicMembership,
  type PublicOrganization,
  type PublicUser,
  type Tenant,
} from "./dto";
import { consumeRateLimit, type RateLimitRule } from "./rate-limit";
import { normalizeEmail } from "./sign-in";

export type TenantErrorCode =
  | "unauthenticated"
  | "no_tenant"
  | "tenant_changed"
  | "not_found"
  | "forbidden"
  | "reauth_required"
  | "rate_limited"
  | "invalid_input"
  | "last_owner"
  | "already_member"
  | "wrong_recipient"
  | "unknown";

export type Result<T> = { ok: true; data: T } | { ok: false; error: TenantErrorCode };

// Set only by `getViewer`, so a `Viewer` (and a `TenantViewer`) can't be built by hand: a read
// that takes one can trust its session and tenant were verified.
const VERIFIED: unique symbol = Symbol("verified viewer");

export interface Viewer {
  readonly [VERIFIED]: true;
  user: PublicUser;
  session: { createdAt: Date; expiresAt: Date; isFresh: boolean };
  tenant: Tenant | null;
  memberships: PublicMembership[];
  /** Server only: never put these in props, responses or logs sent to the browser. */
  internal: { userId: number; organizationId: number | null; memberId: number | null };
}

/** Invitations a user may send per hour. */
export const INVITE_LIMIT: RateLimitRule = { window: 60 * 60, max: 20 };

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const fail = (error: TenantErrorCode): { ok: false; error: TenantErrorCode } => ({
  ok: false,
  error,
});

const publicIdSchema = z.uuid();
const roleSchema = z.enum(ROLES);
const emailSchema = z.email().max(254);
// One line of printable text: names end up in emails and other people's screens.
const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  // oxlint-disable-next-line no-control-regex
  .regex(/^[^\u0000-\u001f\u007f]+$/);

const organizationColumns = {
  id: organization.id,
  publicId: organization.publicId,
  name: organization.name,
  slug: organization.slug,
  logo: organization.logo,
};

/**
 * The signed-in viewer, or `null`. Checks on every call that the active organization's
 * membership still exists, so a removed member loses the tenant immediately: if it's gone the
 * session falls back to their most recent other membership (and is updated), or to no tenant.
 */
export async function getViewer(auth: Auth, headers: Headers): Promise<Viewer | null> {
  const result = await auth.api.getSession({ headers });
  if (!result) return null;
  const { db } = auth.$deps;
  const userId = Number(result.user.id);

  const rows = await db
    .select({
      memberId: member.id,
      memberPublicId: member.publicId,
      role: member.role,
      organization: organizationColumns,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, userId))
    .orderBy(desc(member.createdAt), desc(member.id));

  // Added by the organization plugin, which Better Auth's session type doesn't pick up.
  const activeId =
    "activeOrganizationId" in result.session &&
    typeof result.session.activeOrganizationId === "string"
      ? result.session.activeOrganizationId
      : null;
  let active = rows.find((row) => String(row.organization.id) === activeId);
  if (active === undefined) {
    active = rows[0];
    const fallbackId = active === undefined ? null : String(active.organization.id);
    if (fallbackId !== activeId) {
      // Membership was just verified above, so this skips `setActiveOrganization` (which would
      // also try to rewrite the cookie, impossible from a Server Component). The cookie only
      // holds the session token, so updating the row is enough.
      const context = await auth.$context;
      await context.internalAdapter.updateSession(result.session.token, {
        activeOrganizationId: fallbackId,
      });
    }
  }

  const createdAt = new Date(result.session.createdAt);
  return {
    [VERIFIED]: true,
    user: toPublicUser(await publicUserRow(db, userId)),
    session: {
      createdAt,
      expiresAt: new Date(result.session.expiresAt),
      isFresh: Date.now() - createdAt.getTime() < SESSION_FRESH_AGE * 1000,
    },
    tenant:
      active === undefined
        ? null
        : {
            organization: toPublicOrganization(active.organization),
            role: toRole(active.role),
            memberPublicId: active.memberPublicId,
          },
    memberships: rows.map((row) =>
      toPublicMembership({ ...row, isActive: row.memberId === active?.memberId }),
    ),
    internal: {
      userId,
      organizationId: active?.organization.id ?? null,
      memberId: active?.memberId ?? null,
    },
  };
}

/** A viewer with a verified tenant, from `requireTenant` or `tenantOf`. */
export type TenantViewer = Viewer & {
  tenant: Tenant;
  internal: Viewer["internal"] & { organizationId: number; memberId: number };
};

/** The viewer and their verified tenant, or why there isn't one. */
export async function requireTenant(auth: Auth, headers: Headers): Promise<Result<TenantViewer>> {
  return tenantOf(await getViewer(auth, headers));
}

/** `requireTenant` for a viewer already looked up, so a request needs only one lookup. */
export function tenantOf(viewer: Viewer | null): Result<TenantViewer> {
  if (viewer === null) return fail("unauthenticated");
  const { tenant, internal } = viewer;
  if (tenant === null || internal.organizationId === null || internal.memberId === null) {
    return fail("no_tenant");
  }
  return ok({
    ...viewer,
    tenant,
    internal: { ...internal, organizationId: internal.organizationId, memberId: internal.memberId },
  });
}

/** The viewer's organizations, most recently joined first. */
export function listMemberships(viewer: Viewer): PublicMembership[] {
  return viewer.memberships;
}

export async function switchOrganization(
  auth: Auth,
  headers: Headers,
  input: { organizationPublicId: string },
): Promise<Result<PublicOrganization>> {
  const viewer = await getViewer(auth, headers);
  if (viewer === null) return fail("unauthenticated");
  if (!publicIdSchema.safeParse(input.organizationPublicId).success) return fail("not_found");

  const { db } = auth.$deps;
  // Only organizations the viewer belongs to; anything else reads as not found.
  const [target] = await db
    .select(organizationColumns)
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(
      and(
        eq(member.userId, viewer.internal.userId),
        eq(organization.publicId, input.organizationPublicId),
      ),
    )
    .limit(1);
  if (target === undefined) return fail("not_found");

  const called = await call(() =>
    auth.api.setActiveOrganization({ headers, body: { organizationId: String(target.id) } }),
  );
  if (!called.ok) return called;
  await audit(auth, headers, {
    action: "org.switched",
    actorUserId: viewer.internal.userId,
    organizationId: target.id,
    target: { type: "organization", publicId: target.publicId },
  });
  return ok(toPublicOrganization(target));
}

/** Members of the viewer's tenant, longest-standing first. */
export async function listMembers(auth: Auth, viewer: TenantViewer): Promise<PublicMember[]> {
  const rows = await selectMembers(auth.$deps.db, viewer.internal.organizationId);
  return rows.map(toPublicMember);
}

/**
 * Pending invitations of the viewer's tenant, newest first, including expired ones (still
 * `pending` to Better Auth) so the page can mark them and offer to send them again.
 */
export async function listInvitations(
  auth: Auth,
  viewer: TenantViewer,
): Promise<PublicInvitation[]> {
  const rows = await selectInvitations(auth.$deps.db, {
    organizationId: viewer.internal.organizationId,
    status: "pending",
  });
  return rows.map(toPublicInvitation);
}

/**
 * Invitations addressed to the viewer's own email that they can still answer (pending and not
 * expired), newest first, for `/no-workspace`. Invitations are stored with the normalized email
 * (`inviteMember`), and so is the user's.
 */
export async function listMyInvitations(auth: Auth, viewer: Viewer): Promise<PublicInvitation[]> {
  const rows = await selectInvitations(auth.$deps.db, {
    email: normalizeEmail(viewer.user.email),
    status: "pending",
    expiresAfter: new Date(),
  });
  return rows.map(toPublicInvitation);
}

/**
 * Invites `email` to the viewer's tenant (rate limited per inviter). Inviting an address again
 * replaces its pending invitations, expired ones included: Better Auth's
 * `cancelPendingInvitationsOnReInvite` only sees unexpired ones, so the rest are cancelled here,
 * through Better Auth, once the new invitation exists. Each replaced one is audited as cancelled.
 */
export function inviteMember(
  auth: Auth,
  headers: Headers,
  input: { organizationPublicId: string; email: string; role: Role },
): Promise<Result<PublicInvitation>> {
  return mutateTenant(
    auth,
    headers,
    { fresh: false, organizationPublicId: input.organizationPublicId },
    async ({ db, viewer, callApi, recordAudit }) => {
      const email = emailSchema.safeParse(normalizeEmail(input.email));
      const role = roleSchema.safeParse(input.role);
      if (!email.success || !role.success) return fail("invalid_input");
      const { userId, organizationId } = viewer.internal;

      const limit = await consumeRateLimit(auth.$deps.storage, `invite:${userId}`, INVITE_LIMIT);
      if (!limit.ok) return fail("rate_limited");

      const replaced = await pendingInvitationsFor(db, organizationId, email.data);
      const created = await callApi(() =>
        auth.api.createInvitation({
          headers,
          body: { email: email.data, role: role.data, organizationId: String(organizationId) },
        }),
      );
      if (!created.ok) return created;
      const createdId = Number(created.data.id);

      const [row] = await selectInvitations(db, { organizationId, id: createdId });
      if (row === undefined) return fail("unknown");
      await recordAudit({
        action: "org.invitation.created",
        target: { type: "invitation", publicId: row.publicId },
        metadata: { role: role.data },
      });

      // Better Auth has cancelled the unexpired one already; cancel what it skipped.
      const stillPending = new Set(
        (await pendingInvitationsFor(db, organizationId, email.data, createdId)).map((i) => i.id),
      );
      for (const old of replaced) {
        if (stillPending.has(old.id)) {
          // Sequential on purpose: few rows, and each is its own Better Auth call.
          // oxlint-disable-next-line no-await-in-loop
          const cancelled = await callApi(() =>
            auth.api.cancelInvitation({ headers, body: { invitationId: String(old.id) } }),
          );
          if (!cancelled.ok) continue;
        }
        // oxlint-disable-next-line no-await-in-loop
        await recordAudit({
          action: "org.invitation.cancelled",
          target: { type: "invitation", publicId: old.publicId },
          metadata: { replacedBy: row.publicId },
        });
      }
      return ok(toPublicInvitation(row));
    },
  );
}

export function changeMemberRole(
  auth: Auth,
  headers: Headers,
  input: { organizationPublicId: string; memberPublicId: string; role: Role },
): Promise<Result<PublicMember>> {
  return mutateTenant(
    auth,
    headers,
    { fresh: true, organizationPublicId: input.organizationPublicId },
    async ({ db, viewer, callApi, recordAudit }) => {
      const role = roleSchema.safeParse(input.role);
      if (!role.success) return fail("invalid_input");
      const { organizationId } = viewer.internal;

      const target = await findMember(db, organizationId, input.memberPublicId);
      if (target === undefined) return fail("not_found");

      const updated = await callApi(() =>
        auth.api.updateMemberRole({
          headers,
          body: {
            memberId: String(target.id),
            role: role.data,
            organizationId: String(organizationId),
          },
        }),
      );
      if (!updated.ok) return updated;

      await recordAudit({
        action: "org.member.role_changed",
        target: { type: "member", publicId: target.publicId },
        metadata: { from: target.role, to: role.data },
      });
      const [row] = await selectMembers(db, organizationId, target.id);
      return row === undefined ? fail("not_found") : ok(toPublicMember(row));
    },
  );
}

export function removeMember(
  auth: Auth,
  headers: Headers,
  input: { organizationPublicId: string; memberPublicId: string },
): Promise<Result<null>> {
  return mutateTenant(
    auth,
    headers,
    { fresh: true, organizationPublicId: input.organizationPublicId },
    async ({ db, viewer, callApi, recordAudit }) => {
      const { organizationId } = viewer.internal;
      const target = await findMember(db, organizationId, input.memberPublicId);
      if (target === undefined) return fail("not_found");

      const removed = await callApi(() =>
        auth.api.removeMember({
          headers,
          body: { memberIdOrEmail: String(target.id), organizationId: String(organizationId) },
        }),
      );
      if (!removed.ok) return removed;

      await recordAudit({
        action: "org.member.removed",
        target: { type: "member", publicId: target.publicId },
        metadata: { role: target.role },
      });
      return ok(null);
    },
  );
}

export function cancelInvitation(
  auth: Auth,
  headers: Headers,
  input: { organizationPublicId: string; invitationPublicId: string },
): Promise<Result<null>> {
  return mutateTenant(
    auth,
    headers,
    { fresh: true, organizationPublicId: input.organizationPublicId },
    async ({ db, viewer, callApi, recordAudit }) => {
      if (!publicIdSchema.safeParse(input.invitationPublicId).success) return fail("not_found");
      const [target] = await db
        .select({ id: invitation.id, publicId: invitation.publicId })
        .from(invitation)
        .where(
          and(
            eq(invitation.organizationId, viewer.internal.organizationId),
            eq(invitation.publicId, input.invitationPublicId),
            eq(invitation.status, "pending"),
          ),
        )
        .limit(1);
      if (target === undefined) return fail("not_found");

      const cancelled = await callApi(() =>
        auth.api.cancelInvitation({ headers, body: { invitationId: String(target.id) } }),
      );
      if (!cancelled.ok) return cancelled;

      await recordAudit({
        action: "org.invitation.cancelled",
        target: { type: "invitation", publicId: target.publicId },
      });
      return ok(null);
    },
  );
}

/**
 * An invitation addressed to the viewer, for `/invite/[publicId]`. It isn't in the viewer's
 * tenant (they haven't joined yet), so Better Auth's recipient check (the invitation's email is
 * the viewer's) is what authorizes reading it; a different account gets `wrong_recipient`.
 */
export async function getInvitation(
  auth: Auth,
  headers: Headers,
  input: { invitationPublicId: string },
): Promise<Result<PublicInvitation>> {
  const found = await invitationForViewer(auth, headers, input.invitationPublicId);
  if (!found.ok) return found;
  const checked = await call(() =>
    auth.api.getInvitation({ headers, query: { id: String(found.data.invitationId) } }),
  );
  if (!checked.ok) return checked;
  const [row] = await selectInvitations(auth.$deps.db, { id: found.data.invitationId });
  return row === undefined ? fail("not_found") : ok(toPublicInvitation(row));
}

export async function acceptInvitation(
  auth: Auth,
  headers: Headers,
  input: { invitationPublicId: string },
): Promise<Result<{ organization: PublicOrganization }>> {
  const found = await invitationForViewer(auth, headers, input.invitationPublicId);
  if (!found.ok) return found;
  const { invitationId, organizationId, viewer } = found.data;

  // Better Auth checks the recipient, status and expiry, adds the member and makes the
  // organization active on this session.
  const accepted = await call(() =>
    auth.api.acceptInvitation({ headers, body: { invitationId: String(invitationId) } }),
  );
  if (!accepted.ok) return accepted;

  const [org] = await auth.$deps.db
    .select(organizationColumns)
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);
  if (org === undefined) return fail("not_found");
  await audit(auth, headers, {
    action: "org.invitation.accepted",
    actorUserId: viewer.internal.userId,
    organizationId,
    target: { type: "invitation", publicId: input.invitationPublicId },
  });
  return ok({ organization: toPublicOrganization(org) });
}

export async function declineInvitation(
  auth: Auth,
  headers: Headers,
  input: { invitationPublicId: string },
): Promise<Result<null>> {
  const found = await invitationForViewer(auth, headers, input.invitationPublicId);
  if (!found.ok) return found;
  const { invitationId, organizationId, viewer } = found.data;

  const declined = await call(() =>
    auth.api.rejectInvitation({ headers, body: { invitationId: String(invitationId) } }),
  );
  if (!declined.ok) return declined;

  await audit(auth, headers, {
    action: "org.invitation.declined",
    actorUserId: viewer.internal.userId,
    organizationId,
    target: { type: "invitation", publicId: input.invitationPublicId },
  });
  return ok(null);
}

export async function updateProfileName(
  auth: Auth,
  headers: Headers,
  input: { name: string },
): Promise<Result<PublicUser>> {
  const viewer = await getViewer(auth, headers);
  if (viewer === null) return fail("unauthenticated");
  const name = nameSchema.safeParse(input.name);
  if (!name.success) return fail("invalid_input");

  const updated = await call(() => auth.api.updateUser({ headers, body: { name: name.data } }));
  if (!updated.ok) return updated;

  await audit(auth, headers, {
    action: "user.profile_updated",
    actorUserId: viewer.internal.userId,
    target: { type: "user", publicId: viewer.user.publicId },
    metadata: { fields: ["name"] },
  });
  return ok(toPublicUser(await publicUserRow(auth.$deps.db, viewer.internal.userId)));
}

/**
 * Signs a user out everywhere, immediately: deletes their sessions in Postgres and in the Redis
 * session cache (Better Auth's `deleteUserSessions`), and audits `auth.sessions_revoked`. Use it
 * (or Better Auth's own revoke calls) instead of deleting session rows with SQL, which leaves the
 * cached sessions valid until they expire (ADR 0001, "Session cache trade-off").
 *
 * It checks no permissions: call it only from trusted server code (incident tooling, an account
 * deactivation the caller has already authorized), never straight from a Server Action's input.
 */
export async function revokeUserSessions(auth: Auth, userPublicId: string): Promise<Result<null>> {
  if (!publicIdSchema.safeParse(userPublicId).success) return fail("not_found");
  const { db } = auth.$deps;
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.publicId, userPublicId))
    .limit(1);
  if (row === undefined) return fail("not_found");

  const context = await auth.$context;
  await context.internalAdapter.deleteUserSessions(String(row.id));
  await writeAuditEvent(db, {
    action: "auth.sessions_revoked",
    actorUserId: null,
    target: { type: "user", publicId: userPublicId },
  });
  return ok(null);
}

/** The client IP by Better Auth's trust rules (`AUTH_TRUSTED_IP_HEADER`), for limiters and logs. */
export function clientIp(auth: Auth, headers: Headers): string | null {
  return getIP(headers, auth.options);
}

// --- helpers ---

interface TenantMutation {
  viewer: TenantViewer;
  db: Database;
  /** `call` with the viewer's role, so Better Auth's owner errors map correctly. */
  callApi: <T>(fn: () => Promise<T>) => Promise<Result<T>>;
  /** Writes an audit event by the viewer, in their tenant. */
  recordAudit: (event: Omit<AuditEventInput, "actorUserId" | "organizationId">) => Promise<void>;
}

/**
 * The shape every tenant mutation shares: resolve the viewer's tenant, refuse with
 * `tenant_changed` unless it is the workspace the caller's page showed (`organizationPublicId`),
 * require a fresh session when `fresh`, then run `fn`, which resolves its target within the
 * tenant, calls Better Auth and audits. The tenant check comes before every other check and side
 * effect (input validation, rate limits, emails, audit rows).
 */
async function mutateTenant<T>(
  auth: Auth,
  headers: Headers,
  options: { fresh: boolean; organizationPublicId: string },
  fn: (mutation: TenantMutation) => Promise<Result<T>>,
): Promise<Result<T>> {
  const viewer = await requireTenant(auth, headers);
  if (!viewer.ok) return viewer;
  if (viewer.data.tenant.organization.publicId !== options.organizationPublicId) {
    return fail("tenant_changed");
  }
  if (options.fresh && !viewer.data.session.isFresh) return fail("reauth_required");
  const { userId, organizationId } = viewer.data.internal;
  return fn({
    viewer: viewer.data,
    db: auth.$deps.db,
    callApi: (apiCall) => call(apiCall, viewer.data.tenant.role),
    recordAudit: (event) => audit(auth, headers, { ...event, actorUserId: userId, organizationId }),
  });
}

async function publicUserRow(db: Database, userId: number) {
  const [row] = await db
    .select({ publicId: user.publicId, name: user.name, email: user.email, image: user.image })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (row === undefined) throw new Error("Session user not found");
  return row;
}

async function findMember(db: Database, organizationId: number, memberPublicId: string) {
  if (!publicIdSchema.safeParse(memberPublicId).success) return undefined;
  const [row] = await db
    .select({ id: member.id, publicId: member.publicId, role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.publicId, memberPublicId)))
    .limit(1);
  return row;
}

function selectMembers(db: Database, organizationId: number, memberId?: number) {
  return db
    .select({
      publicId: member.publicId,
      role: member.role,
      createdAt: member.createdAt,
      user: { publicId: user.publicId, name: user.name, email: user.email, image: user.image },
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(
      and(
        eq(member.organizationId, organizationId),
        memberId === undefined ? undefined : eq(member.id, memberId),
      ),
    )
    .orderBy(asc(member.createdAt), asc(member.id));
}

/** Pending invitations (expired ones included) for `email` in an organization. */
function pendingInvitationsFor(
  db: Database,
  organizationId: number,
  email: string,
  exceptId?: number,
) {
  return db
    .select({ id: invitation.id, publicId: invitation.publicId })
    .from(invitation)
    .where(
      and(
        eq(invitation.organizationId, organizationId),
        eq(invitation.email, email),
        eq(invitation.status, "pending"),
        exceptId === undefined ? undefined : ne(invitation.id, exceptId),
      ),
    );
}

const inviter = alias(user, "inviter");

function selectInvitations(
  db: Database,
  where: {
    organizationId?: number;
    id?: number;
    email?: string;
    status?: InvitationStatus;
    /** Only invitations that expire after this moment. */
    expiresAfter?: Date;
  },
) {
  return db
    .select({
      publicId: invitation.publicId,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      organization: {
        publicId: organization.publicId,
        name: organization.name,
        slug: organization.slug,
        logo: organization.logo,
      },
      inviter: { name: inviter.name },
    })
    .from(invitation)
    .innerJoin(organization, eq(invitation.organizationId, organization.id))
    .innerJoin(inviter, eq(invitation.inviterId, inviter.id))
    .where(
      and(
        where.organizationId === undefined
          ? undefined
          : eq(invitation.organizationId, where.organizationId),
        where.id === undefined ? undefined : eq(invitation.id, where.id),
        where.email === undefined ? undefined : eq(invitation.email, where.email),
        where.status === undefined ? undefined : eq(invitation.status, where.status),
        where.expiresAfter === undefined ? undefined : gt(invitation.expiresAt, where.expiresAfter),
      ),
    )
    .orderBy(desc(invitation.createdAt), desc(invitation.id));
}

/** Resolves an invitation publicId for the signed-in viewer (authorization is Better Auth's). */
async function invitationForViewer(
  auth: Auth,
  headers: Headers,
  invitationPublicId: string,
): Promise<Result<{ viewer: Viewer; invitationId: number; organizationId: number }>> {
  const viewer = await getViewer(auth, headers);
  if (viewer === null) return fail("unauthenticated");
  if (!publicIdSchema.safeParse(invitationPublicId).success) return fail("not_found");
  const [row] = await auth.$deps.db
    .select({ id: invitation.id, organizationId: invitation.organizationId })
    .from(invitation)
    .where(eq(invitation.publicId, invitationPublicId))
    .limit(1);
  if (row === undefined) return fail("not_found");
  return ok({ viewer, invitationId: row.id, organizationId: row.organizationId });
}

/** Runs a Better Auth call and maps its errors to our codes; never leaks its messages. */
async function call<T>(fn: () => Promise<T>, actorRole?: Role): Promise<Result<T>> {
  try {
    return ok(await fn());
  } catch (error) {
    const code = apiErrorCode(error, actorRole);
    if (code === "unknown") console.error("Auth API call failed", error);
    return fail(code);
  }
}

export function apiErrorCode(error: unknown, actorRole?: Role): TenantErrorCode {
  if (!isAPIError(error)) return "unknown";
  const code: unknown = error.body?.code;
  // Some of these come with 401 (e.g. YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER), not 403.
  if (typeof code === "string" && code.startsWith("YOU_ARE_NOT_ALLOWED")) return "forbidden";
  switch (code) {
    case "YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER":
    case "YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER":
      // Better Auth also answers "admin removes an owner" with this code.
      return actorRole === "owner" ? "last_owner" : "forbidden";
    case "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION":
      return "already_member";
    case "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION":
      return "wrong_recipient";
    case "INVITATION_NOT_FOUND":
    case "MEMBER_NOT_FOUND":
    case "ORGANIZATION_NOT_FOUND":
    case "INVITER_IS_NO_LONGER_A_MEMBER_OF_THE_ORGANIZATION":
    case "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION":
      return "not_found";
    case "ROLE_NOT_FOUND":
    case "INVALID_EMAIL":
      return "invalid_input";
    case "SESSION_EXPIRED":
      return "reauth_required";
  }
  if (error.statusCode === 401) return "unauthenticated";
  if (error.statusCode === 403) return "forbidden";
  if (error.statusCode === 429) return "rate_limited";
  return "unknown";
}

async function audit(auth: Auth, headers: Headers, event: AuditEventInput): Promise<void> {
  await writeAuditEvent(auth.$deps.db, {
    ipAddress: clientIp(auth, headers),
    userAgent: headers.get("user-agent"),
    ...event,
  });
}
