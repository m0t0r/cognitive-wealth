import { eq, sql } from "drizzle-orm";
import { describe, expect } from "vitest";
import type { Database } from "./index";
import { auditEvent, invitation, member, organization, session, user } from "./schema";
import { test } from "./testing";

// Postgres SQLSTATEs, checked on the driver error Drizzle wraps as `cause`.
const GENERATED_ALWAYS = { cause: { code: "428C9" } };
const UNIQUE_VIOLATION = { cause: { code: "23505" } };
const CHECK_VIOLATION = { cause: { code: "23514" } };

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function createUser(db: Database, email = "ada@example.com") {
  const [row] = await db.insert(user).values({ name: "Ada", email }).returning();
  return row!;
}

async function createOrganization(db: Database, slug = "acme") {
  const [row] = await db.insert(organization).values({ name: "Acme", slug }).returning();
  return row!;
}

async function createSession(db: Database, userId: number, activeOrganizationId?: number) {
  const [row] = await db
    .insert(session)
    .values({
      token: crypto.randomUUID(),
      userId,
      expiresAt: new Date(Date.now() + 60_000),
      activeOrganizationId:
        activeOrganizationId === undefined ? null : String(activeOrganizationId),
    })
    .returning();
  return row!;
}

async function createInvitation(db: Database, organizationId: number, inviterId: number) {
  const [row] = await db
    .insert(invitation)
    .values({
      organizationId,
      inviterId,
      email: "grace@example.com",
      role: "member",
      expiresAt: new Date(Date.now() + 60_000),
    })
    .returning();
  return row!;
}

describe("ids", () => {
  test("generates identity primary keys", async ({ orm }) => {
    const first = await createUser(orm, "first@example.com");
    const second = await createUser(orm, "second@example.com");
    expect(first.id).toEqual(expect.any(Number));
    expect(second.id).toBeGreaterThan(first.id);
  });

  test("refuses an explicit id", async ({ orm }) => {
    await expect(
      orm.execute(sql`insert into "user" (id, name, email) values (42, 'Ada', 'ada@example.com')`),
    ).rejects.toMatchObject(GENERATED_ALWAYS);
  });

  test("defaults publicId to a UUIDv7 on every user-visible table", async ({ orm }) => {
    const u = await createUser(orm);
    const org = await createOrganization(orm);
    const [m] = await orm
      .insert(member)
      .values({ organizationId: org.id, userId: u.id, role: "owner" })
      .returning();
    const inv = await createInvitation(orm, org.id, u.id);

    for (const row of [u, org, m!, inv]) expect(row.publicId).toMatch(UUID_V7);
  });
});

describe("user email", () => {
  test("must be lowercase", async ({ orm }) => {
    await expect(createUser(orm, "Ada@Example.com")).rejects.toMatchObject(CHECK_VIOLATION);
  });

  test("is unique", async ({ orm }) => {
    await createUser(orm);
    await expect(createUser(orm)).rejects.toMatchObject(UNIQUE_VIOLATION);
  });
});

describe("session.activeOrganizationId", () => {
  test("round-trips as a string", async ({ orm }) => {
    const u = await createUser(orm);
    const org = await createOrganization(orm);
    const created = await createSession(orm, u.id, org.id);

    const [row] = await orm
      .select({ activeOrganizationId: session.activeOrganizationId })
      .from(session)
      .where(eq(session.id, created.id));
    expect(row).toEqual({ activeOrganizationId: String(org.id) });
  });

  test("is nulled when its organization is deleted", async ({ orm }) => {
    const u = await createUser(orm);
    const org = await createOrganization(orm);
    const created = await createSession(orm, u.id, org.id);

    await orm.delete(organization).where(eq(organization.id, org.id));

    const rows = await orm
      .select({ id: session.id, activeOrganizationId: session.activeOrganizationId })
      .from(session);
    expect(rows).toEqual([{ id: created.id, activeOrganizationId: null }]);
  });
});

describe("member", () => {
  test("is unique per organization and user", async ({ orm }) => {
    const u = await createUser(orm);
    const acme = await createOrganization(orm, "acme");
    const globex = await createOrganization(orm, "globex");
    await orm.insert(member).values({ organizationId: acme.id, userId: u.id, role: "owner" });
    // The same user can belong to another organization.
    await orm.insert(member).values({ organizationId: globex.id, userId: u.id });

    await expect(
      orm.insert(member).values({ organizationId: acme.id, userId: u.id }),
    ).rejects.toMatchObject(UNIQUE_VIOLATION);
  });

  test("defaults the role to member", async ({ orm }) => {
    const u = await createUser(orm);
    const org = await createOrganization(orm);
    const [row] = await orm
      .insert(member)
      .values({ organizationId: org.id, userId: u.id })
      .returning();
    expect(row!.role).toBe("member");
  });
});

describe("deleting a user", () => {
  test("removes their sessions, memberships and sent invitations, and keeps audit events", async ({
    orm,
  }) => {
    const u = await createUser(orm);
    const org = await createOrganization(orm);
    await createSession(orm, u.id, org.id);
    await orm.insert(member).values({ organizationId: org.id, userId: u.id, role: "owner" });
    await createInvitation(orm, org.id, u.id);
    await orm.insert(auditEvent).values({ action: "auth.sign_in", actorUserId: u.id });

    await orm.delete(user).where(eq(user.id, u.id));

    expect(await orm.$count(session)).toBe(0);
    expect(await orm.$count(member)).toBe(0);
    expect(await orm.$count(invitation)).toBe(0);
    expect(await orm.$count(organization)).toBe(1);
    expect(await orm.select({ actorUserId: auditEvent.actorUserId }).from(auditEvent)).toEqual([
      { actorUserId: null },
    ]);
  });
});

describe("deleting an organization", () => {
  test("removes its members and invitations, and keeps users and audit events", async ({ orm }) => {
    const u = await createUser(orm);
    const org = await createOrganization(orm);
    await orm.insert(member).values({ organizationId: org.id, userId: u.id, role: "owner" });
    await createInvitation(orm, org.id, u.id);
    await orm.insert(auditEvent).values({ action: "org.switched", organizationId: org.id });

    await orm.delete(organization).where(eq(organization.id, org.id));

    expect(await orm.$count(member)).toBe(0);
    expect(await orm.$count(invitation)).toBe(0);
    expect(await orm.$count(user)).toBe(1);
    expect(
      await orm.select({ organizationId: auditEvent.organizationId }).from(auditEvent),
    ).toEqual([{ organizationId: null }]);
  });
});
