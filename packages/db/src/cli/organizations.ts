import { parseArgs } from "node:util";
import { and, eq, isNotNull } from "drizzle-orm";
import type { Database } from "../index.ts";
import { auditEvent, invitation, member, organization, user } from "../schema/index.ts";

/** A problem with the operator's input, printed as is (no stack trace). */
export class CliError extends Error {
  override name = "CliError";
}

export const SLUG_MAX_LENGTH = 48;

const EMAIL = /^[^\s@/\\]+@[^\s@/\\]+\.[^\s@/\\]+$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Trims and lowercases `raw` (the `user.email` check requires lowercase) and checks its shape. */
export function parseOwnerEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (!EMAIL.test(email)) throw new CliError(`Not an email address: ${raw}`);
  return email;
}

/** `Acme Corp.` → `acme-corp`: lowercase `a-z0-9` runs joined by `-`, at most 48 characters. */
export function slugFromName(name: string): string {
  const slug = name
    // Split accented letters into letter + combining mark, then drop the marks: `é` → `e`.
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new CliError(`Can't make a slug from "${name}"; pass one with --slug.`);
  return slug;
}

/** Trims and lowercases an explicit slug, then checks it's what `slugFromName` would produce. */
export function normalizeSlug(raw: string): string {
  const slug = raw.trim().toLowerCase();
  if (slug.length > SLUG_MAX_LENGTH || !SLUG.test(slug)) {
    throw new CliError(
      `Invalid slug "${raw}": use a-z, 0-9 and single hyphens between them, at most ${SLUG_MAX_LENGTH} characters.`,
    );
  }
  return slug;
}

export interface CreateOrganizationInput {
  name: string;
  /** Generated from `name` when omitted. */
  slug?: string | undefined;
  ownerEmail: string;
}

export interface CreatedOrganization {
  publicId: string;
  name: string;
  slug: string;
  owner: { email: string; created: boolean };
}

/**
 * Creates an organization owned by `ownerEmail`: the invite-only way in, since users can't create
 * organizations themselves. A missing owner is created with an empty name (they set it at
 * `/welcome`) and an unverified email (signing in verifies it). The user, organization,
 * membership and `org.created` audit event are written in one transaction, so a taken slug
 * leaves nothing behind.
 */
export async function createOrganization(
  db: Database,
  input: CreateOrganizationInput,
): Promise<CreatedOrganization> {
  const name = input.name.trim();
  if (!name) throw new CliError("The organization name is empty.");
  const email = parseOwnerEmail(input.ownerEmail);
  const slug = input.slug === undefined ? slugFromName(name) : normalizeSlug(input.slug);

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(user)
      .values({ email, name: "", emailVerified: false })
      .onConflictDoNothing({ target: user.email })
      .returning({ id: user.id });
    const [owner] = await tx.select({ id: user.id }).from(user).where(eq(user.email, email));
    if (!owner) throw new Error(`Owner ${email} vanished mid-transaction`);

    const [org] = await tx
      .insert(organization)
      .values({ name, slug })
      .onConflictDoNothing({ target: organization.slug })
      .returning({ id: organization.id, publicId: organization.publicId });
    // Throwing rolls the transaction back, including a user created above.
    if (!org) {
      throw new CliError(
        `An organization with slug "${slug}" already exists; pick another with --slug.`,
      );
    }

    await tx.insert(member).values({ organizationId: org.id, userId: owner.id, role: "owner" });
    await tx.insert(auditEvent).values({
      action: "org.created",
      // The operator running the CLI isn't a user, so there's no actor.
      actorUserId: null,
      organizationId: org.id,
      targetType: "organization",
      targetId: org.publicId,
      metadata: { via: "cli" },
    });

    return { publicId: org.publicId, name, slug, owner: { email, created: inserted.length > 0 } };
  });
}

/** What `pnpm org:deactivate` or `org:reactivate` changed. */
export type OrganizationStatusChange = {
  publicId: string;
  name: string;
  slug: string;
  /** When it was deactivated (or reactivated). */
  at: Date;
  /** Pending invitations canceled by a deactivation; always 0 for a reactivation. */
  canceledInvitations: number;
};

type OrganizationStatusArgs = { slug: string; reason: string };

/**
 * `pnpm org:deactivate` and `org:reactivate`'s arguments, `--slug <slug> --reason <text>`:
 * `{ help: true }` for `--help`, otherwise both, checked (a `CliError` with `usage` when one is
 * missing).
 */
export function parseOrganizationStatusArgs({
  args,
  usage,
}: {
  args: string[];
  usage: string;
}): { help: true } | ({ help: false } & OrganizationStatusArgs) {
  // `pnpm org:deactivate -- --slug …` passes the separator through.
  const rest = args[0] === "--" ? args.slice(1) : args;
  let values;
  try {
    ({ values } = parseArgs({
      args: rest,
      options: {
        slug: { type: "string" },
        reason: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
    }));
  } catch (error) {
    throw new CliError(`${error instanceof Error ? error.message : String(error)}\n\n${usage}`);
  }
  if (values.help) return { help: true };
  if (values.slug === undefined || values.reason === undefined) throw new CliError(usage);
  return { help: false, slug: normalizeSlug(values.slug), reason: parseReason(values.reason) };
}

/** The reason is a note in the audit log, not a document. */
export const REASON_MAX_LENGTH = 500;

/** Trims `raw` and checks it says something, at most {@link REASON_MAX_LENGTH} characters. */
export function parseReason(raw: string): string {
  const reason = raw.trim();
  if (!reason) throw new CliError("The reason is empty: say why with --reason.");
  if (reason.length > REASON_MAX_LENGTH) {
    throw new CliError(`The reason is longer than ${REASON_MAX_LENGTH} characters.`);
  }
  return reason;
}

/**
 * Deactivates the Firm `slug` (ADR 0022): sets `deactivated_at`, cancels its pending invitations
 * and audits `org.deactivated` with the operator's reason, in one transaction. Its records and
 * memberships are untouched, and nobody is signed out: `getViewer` stops offering the Firm from
 * its members' next request, and `withFirm` refuses it. Throws `CliError`, writing nothing, for an
 * unknown slug or a Firm that is already deactivated.
 */
export async function deactivateOrganization(
  db: Database,
  input: OrganizationStatusArgs,
): Promise<OrganizationStatusChange> {
  const reason = parseReason(input.reason);
  const slug = normalizeSlug(input.slug);
  return db.transaction(async (tx) => {
    const org = await lockOrganization(tx, slug);
    if (org.deactivatedAt !== null) {
      throw new CliError(
        `${org.name} (${slug}) is already deactivated, since ${org.deactivatedAt.toISOString()}. Nothing was changed.`,
      );
    }
    const [updated] = await tx
      .update(organization)
      .set({ deactivatedAt: new Date() })
      .where(eq(organization.id, org.id))
      .returning({ at: organization.deactivatedAt });
    if (!updated?.at) throw new Error(`${slug} vanished mid-transaction`);
    const canceled = await tx
      .update(invitation)
      .set({ status: "canceled" })
      .where(and(eq(invitation.organizationId, org.id), eq(invitation.status, "pending")))
      .returning({ publicId: invitation.publicId });
    // The operator running the CLI isn't a user, so no event has an actor.
    if (canceled.length > 0) {
      await tx.insert(auditEvent).values(
        canceled.map((row) => ({
          action: "org.invitation.cancelled",
          actorUserId: null,
          organizationId: org.id,
          targetType: "invitation",
          targetId: row.publicId,
          metadata: { reason: "firm_deactivated" },
        })),
      );
    }
    await auditStatusChange(tx, { org, action: "org.deactivated", reason });
    return { ...describeOrganization(org), at: updated.at, canceledInvitations: canceled.length };
  });
}

/**
 * Reactivates the Firm `slug`: clears `deactivated_at` and audits `org.reactivated`, so its
 * members find it again on their next request. Invitations canceled at deactivation stay
 * canceled. Throws `CliError`, writing nothing, for an unknown slug or a Firm that is active.
 */
export async function reactivateOrganization(
  db: Database,
  input: OrganizationStatusArgs,
): Promise<OrganizationStatusChange> {
  const reason = parseReason(input.reason);
  const slug = normalizeSlug(input.slug);
  return db.transaction(async (tx) => {
    const org = await lockOrganization(tx, slug);
    const [updated] = await tx
      .update(organization)
      .set({ deactivatedAt: null })
      .where(and(eq(organization.id, org.id), isNotNull(organization.deactivatedAt)))
      .returning({ id: organization.id });
    if (updated === undefined) {
      throw new CliError(`${org.name} (${slug}) isn't deactivated. Nothing was changed.`);
    }
    await auditStatusChange(tx, { org, action: "org.reactivated", reason });
    return { ...describeOrganization(org), at: new Date(), canceledInvitations: 0 };
  });
}

type LockedOrganization = {
  id: number;
  publicId: string;
  name: string;
  slug: string;
  deactivatedAt: Date | null;
};

/** The organization `slug`, locked until the transaction ends, so two runs can't both change it. */
async function lockOrganization(tx: Database, slug: string): Promise<LockedOrganization> {
  const [org] = await tx
    .select({
      id: organization.id,
      publicId: organization.publicId,
      name: organization.name,
      slug: organization.slug,
      deactivatedAt: organization.deactivatedAt,
    })
    .from(organization)
    .where(eq(organization.slug, slug))
    .for("update");
  if (org === undefined) throw new CliError(`No organization has the slug "${slug}".`);
  return org;
}

type AuditStatusChangeArgs = {
  org: LockedOrganization;
  action: "org.deactivated" | "org.reactivated";
  reason: string;
};

async function auditStatusChange(
  tx: Database,
  { org, action, reason }: AuditStatusChangeArgs,
): Promise<void> {
  await tx.insert(auditEvent).values({
    action,
    actorUserId: null,
    organizationId: org.id,
    targetType: "organization",
    targetId: org.publicId,
    metadata: { via: "cli", reason },
  });
}

function describeOrganization({ publicId, name, slug }: LockedOrganization) {
  return { publicId, name, slug };
}
