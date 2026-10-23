import type { TestInfo } from "@playwright/test";
import type { Database } from "@repo/db";
import { invitation, member, organization, session, user } from "@repo/db/schema";

// Seeds go straight through Drizzle (as the dev seed and `org:create` do), so no rate limit,
// email or Better Auth hook is involved. `publicId`s come from the database defaults.

export type Role = "owner" | "admin" | "member";

export interface SeededUser {
  id: number;
  publicId: string;
  email: string;
  name: string;
}

export interface SeededOrganization {
  id: number;
  publicId: string;
  name: string;
  /** In the order given to `seedOrganization`. */
  members: Array<{ id: number; publicId: string }>;
}

/**
 * An address unique to this test (and repeat) but the same on every run, so aria snapshots can
 * show it. All workers share one Mailpit, so tests must never share an address.
 */
export function uniqueEmail(testInfo: TestInfo, label: string): string {
  return `${label}-${testInfo.testId}-${testInfo.repeatEachIndex}@e2e.test`.toLowerCase();
}

/** A user who can sign in. An empty `name` sends them to `/welcome` first. */
export async function seedUser(
  db: Database,
  { email, name }: { email: string; name: string },
): Promise<SeededUser> {
  const [row] = await db
    .insert(user)
    .values({ email, name, emailVerified: true })
    .returning({ id: user.id, publicId: user.publicId, email: user.email, name: user.name });
  if (!row) throw new Error(`Could not seed ${email}`);
  return row;
}

/**
 * An organization and its memberships. A user's session starts in the organization they joined
 * last, so pass `joinedAt` to control which one that is (and to keep "Joined" dates stable).
 */
export async function seedOrganization(
  db: Database,
  {
    name,
    members,
  }: { name: string; members: Array<{ user: SeededUser; role: Role; joinedAt?: Date }> },
): Promise<SeededOrganization> {
  const slug = name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");
  const [org] = await db
    .insert(organization)
    .values({ name, slug })
    .returning({ id: organization.id, publicId: organization.publicId, name: organization.name });
  if (!org) throw new Error(`Could not seed ${name}`);
  const rows =
    members.length === 0
      ? []
      : await db
          .insert(member)
          .values(
            members.map((entry) => ({
              organizationId: org.id,
              userId: entry.user.id,
              role: entry.role,
              ...(entry.joinedAt ? { createdAt: entry.joinedAt } : {}),
            })),
          )
          .returning({ id: member.id, publicId: member.publicId });
  return { ...org, members: rows };
}

/** A pending invitation to `organization`, from `inviter`. */
export async function seedInvitation(
  db: Database,
  {
    organization: org,
    email,
    role,
    inviter,
    expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  }: {
    organization: SeededOrganization;
    email: string;
    role: Role;
    inviter: SeededUser;
    expiresAt?: Date;
  },
): Promise<{ id: number; publicId: string }> {
  const [row] = await db
    .insert(invitation)
    .values({ organizationId: org.id, email, role, inviterId: inviter.id, expiresAt })
    .returning({ id: invitation.id, publicId: invitation.publicId });
  if (!row) throw new Error(`Could not seed an invitation for ${email}`);
  return row;
}

/**
 * Backdates every session in this test's database past the 1-hour fresh-session window. Call it
 * when only the user it's meant for has signed in. Better Auth reads sessions from its Redis cache
 * first, so clear that afterwards (`workerRedis.reset()`) for the change to be seen.
 */
export async function backdateSessions(db: Database, hours = 2): Promise<void> {
  await db.update(session).set({ createdAt: new Date(Date.now() - hours * 60 * 60 * 1000) });
}
