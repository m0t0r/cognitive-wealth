import { eq } from "drizzle-orm";
import type { Database } from "../index";
import { auditEvent, member, organization, user } from "../schema/index.ts";

/** A problem with the operator's input, printed as is (no stack trace). */
export class CliError extends Error {
  override name = "CliError";
}

export const SLUG_MAX_LENGTH = 48;

const EMAIL = /^[^\s@/\\]+@[^\s@/\\]+\.[^\s@/\\]+$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Trims and lowercases `raw` (the `user.email` check requires lowercase) and checks its shape. */
export function normalizeEmail(raw: string): string {
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
  const email = normalizeEmail(input.ownerEmail);
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
