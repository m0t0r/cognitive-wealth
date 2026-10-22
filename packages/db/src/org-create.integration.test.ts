import { count, eq } from "drizzle-orm";
import { describe, expect } from "vitest";
import { CliError, createOrganization, slugFromName } from "./cli/organizations";
import type { Database } from "./index";
import { auditEvent, member, organization, user } from "./schema";
import { test } from "./testing";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function rowCounts(db: Database) {
  const tables = { user, organization, member, auditEvent };
  const entries = await Promise.all(
    Object.entries(tables).map(async ([name, table]) => {
      const [row] = await db.select({ n: count() }).from(table);
      return [name, row!.n] as const;
    }),
  );
  return Object.fromEntries(entries);
}

async function membershipsOf(db: Database, email: string) {
  return db
    .select({ slug: organization.slug, role: member.role })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(user.email, email));
}

describe("createOrganization", () => {
  test("creates a missing owner with an empty name and an unverified email", async ({ orm }) => {
    const created = await createOrganization(orm, {
      name: "Acme Corp",
      ownerEmail: "ceo@example.com",
    });

    expect(created).toEqual({
      publicId: expect.stringMatching(UUID_V7),
      name: "Acme Corp",
      slug: "acme-corp",
      owner: { email: "ceo@example.com", created: true },
    });
    expect(
      await orm
        .select({ name: user.name, emailVerified: user.emailVerified })
        .from(user)
        .where(eq(user.email, "ceo@example.com")),
    ).toEqual([{ name: "", emailVerified: false }]);
    expect(await membershipsOf(orm, "ceo@example.com")).toEqual([
      { slug: "acme-corp", role: "owner" },
    ]);
  });

  test("reuses an existing user, matching the email case-insensitively", async ({ orm }) => {
    await orm.insert(user).values({ email: "ada@example.com", name: "Ada", emailVerified: true });

    const created = await createOrganization(orm, {
      name: "Analytical Engines",
      slug: "engines",
      ownerEmail: "  Ada@Example.COM ",
    });

    expect(created.owner).toEqual({ email: "ada@example.com", created: false });
    expect(
      await orm.select({ name: user.name, emailVerified: user.emailVerified }).from(user),
    ).toEqual([{ name: "Ada", emailVerified: true }]);
    expect(await membershipsOf(orm, "ada@example.com")).toEqual([
      { slug: "engines", role: "owner" },
    ]);
  });

  test("stores a new owner's email in lowercase", async ({ orm }) => {
    await createOrganization(orm, { name: "Globex", ownerEmail: "Hank@Globex.TEST" });

    expect(await orm.select({ email: user.email }).from(user)).toEqual([
      { email: "hank@globex.test" },
    ]);
  });

  test("writes an org.created audit event targeting the organization", async ({ orm }) => {
    const created = await createOrganization(orm, { name: "Acme", ownerEmail: "ceo@example.com" });
    const [org] = await orm.select({ id: organization.id }).from(organization);

    expect(
      await orm
        .select({
          action: auditEvent.action,
          actorUserId: auditEvent.actorUserId,
          organizationId: auditEvent.organizationId,
          targetType: auditEvent.targetType,
          targetId: auditEvent.targetId,
          metadata: auditEvent.metadata,
        })
        .from(auditEvent),
    ).toEqual([
      {
        action: "org.created",
        actorUserId: null,
        organizationId: org!.id,
        targetType: "organization",
        targetId: created.publicId,
        metadata: { via: "cli" },
      },
    ]);
  });

  test("rejects a taken slug and rolls everything back", async ({ orm }) => {
    await createOrganization(orm, { name: "Acme", ownerEmail: "first@example.com" });
    const before = await rowCounts(orm);

    await expect(
      createOrganization(orm, { name: "ACME", ownerEmail: "second@example.com" }),
    ).rejects.toThrow(
      new CliError('An organization with slug "acme" already exists; pick another with --slug.'),
    );

    expect(await rowCounts(orm)).toEqual(before);
    expect(await orm.select().from(user).where(eq(user.email, "second@example.com"))).toEqual([]);
  });

  test("validates the input before writing anything", async ({ orm }) => {
    await expect(
      createOrganization(orm, { name: "Acme", ownerEmail: "not-an-email" }),
    ).rejects.toThrow(/Not an email address/);
    await expect(
      createOrganization(orm, { name: "Acme", slug: "no_underscores", ownerEmail: "a@b.co" }),
    ).rejects.toThrow(/Invalid slug/);
    await expect(createOrganization(orm, { name: "  ", ownerEmail: "a@b.co" })).rejects.toThrow(
      /name is empty/,
    );
    await expect(createOrganization(orm, { name: "!!!", ownerEmail: "a@b.co" })).rejects.toThrow(
      /--slug/,
    );

    expect(await rowCounts(orm)).toEqual({ user: 0, organization: 0, member: 0, auditEvent: 0 });
  });
});

describe("slugFromName", () => {
  test.for([
    ["Acme", "acme"],
    ["Acme Corp.", "acme-corp"],
    ["  Société Générale  ", "societe-generale"],
    ["R&D -- Lab 42", "r-d-lab-42"],
    ["a".repeat(60), "a".repeat(48)],
    [`${"a".repeat(47)} b`, "a".repeat(47)],
  ])("%s → %s", ([name, slug]) => {
    expect(slugFromName(name!)).toBe(slug);
  });
});
