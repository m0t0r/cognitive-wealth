// Deactivating and reactivating a Firm (ADR 0022), as `pnpm org:deactivate` and `org:reactivate`
// do it: as `app`, the role the CLIs connect as in production.
import { and, asc, eq, sql } from "drizzle-orm";
import {
  CliError,
  createOrganization,
  deactivateOrganization,
  reactivateOrganization,
} from "./cli/organizations";
import { FirmDeactivatedError, withFirm } from "./firm";
import { FIRM_SCOPED_TABLES, seedFirm } from "./firm-test-data";
import type { Database } from "./index";
import { auditEvent, household, invitation, member, organization, session, user } from "./schema";
import { test } from "./testing";

async function seedInvitation(
  db: Database,
  { firmId, email, status = "pending" }: { firmId: number; email: string; status?: string },
) {
  const [inviter] = await db
    .select({ id: member.userId })
    .from(member)
    .where(eq(member.organizationId, firmId))
    .limit(1);
  const [row] = await db
    .insert(invitation)
    .values({
      organizationId: firmId,
      email,
      role: "member",
      status,
      inviterId: inviter!.id,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    .returning({ publicId: invitation.publicId });
  return row!.publicId;
}

/** A Firm made by `org:create`, so it has an owner and an `org.created` event. */
async function createFirm(db: Database, slug: string) {
  const created = await createOrganization(db, {
    name: slug,
    slug,
    ownerEmail: `owner@${slug}.test`,
  });
  const [row] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, slug));
  return { ...created, id: row!.id };
}

const deactivatedAt = async (db: Database, slug: string) =>
  (
    await db
      .select({ at: organization.deactivatedAt })
      .from(organization)
      .where(eq(organization.slug, slug))
  )[0]?.at;

const statusEvents = (db: Database) =>
  db
    .select({
      action: auditEvent.action,
      actorUserId: auditEvent.actorUserId,
      organizationId: auditEvent.organizationId,
      targetType: auditEvent.targetType,
      targetId: auditEvent.targetId,
      metadata: auditEvent.metadata,
    })
    .from(auditEvent)
    .where(sql`${auditEvent.action} in ('org.deactivated', 'org.reactivated')`)
    .orderBy(asc(auditEvent.id));

/** Every row of every Firm-scoped table, read as their owner, whom the policies don't hold. */
async function firmScopedRows(owner: Database) {
  const entries = await Promise.all(
    FIRM_SCOPED_TABLES.map(async (table) => {
      const rows = await owner.execute(sql`select * from ${sql.identifier(table)} order by id`);
      return [table, rows] as const;
    }),
  );
  return Object.fromEntries(entries);
}

describe("deactivateOrganization", () => {
  test("sets deactivated_at and audits org.deactivated with no actor", async ({ orm }) => {
    const firm = await createFirm(orm, "acme");

    const result = await deactivateOrganization(orm, { slug: "acme", reason: "Left for Initech" });

    expect(result).toEqual({
      publicId: firm.publicId,
      name: "acme",
      slug: "acme",
      at: expect.any(Date),
      canceledInvitations: 0,
      dryRun: false,
    });
    expect(await deactivatedAt(orm, "acme")).toEqual(result.at);
    expect(await statusEvents(orm)).toEqual([
      {
        action: "org.deactivated",
        actorUserId: null,
        organizationId: firm.id,
        targetType: "organization",
        targetId: firm.publicId,
        metadata: { via: "cli", reason: "Left for Initech" },
      },
    ]);
  });

  test("cancels the Firm's pending invitations and audits each", async ({ orm }) => {
    const acme = await createFirm(orm, "acme");
    const globex = await createFirm(orm, "globex");
    const pending = await seedInvitation(orm, { firmId: acme.id, email: "new@example.com" });
    const accepted = await seedInvitation(orm, {
      firmId: acme.id,
      email: "old@example.com",
      status: "accepted",
    });
    const elsewhere = await seedInvitation(orm, { firmId: globex.id, email: "new@example.com" });

    const result = await deactivateOrganization(orm, { slug: "acme", reason: "Closed" });

    expect(result.canceledInvitations).toBe(1);
    const statuses = await orm
      .select({ publicId: invitation.publicId, status: invitation.status })
      .from(invitation);
    expect(Object.fromEntries(statuses.map((row) => [row.publicId, row.status]))).toEqual({
      [pending]: "canceled",
      [accepted]: "accepted",
      [elsewhere]: "pending",
    });
    expect(
      await orm
        .select({ targetId: auditEvent.targetId, metadata: auditEvent.metadata })
        .from(auditEvent)
        .where(eq(auditEvent.action, "org.invitation.cancelled")),
    ).toEqual([{ targetId: pending, metadata: { reason: "firm_deactivated" } }]);
  });

  test("signs nobody out", async ({ orm }) => {
    await createFirm(orm, "acme");
    const [owner] = await orm
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, "owner@acme.test"));
    await orm.insert(session).values({
      userId: owner!.id,
      token: "token",
      expiresAt: new Date(Date.now() + 60_000),
    });

    await deactivateOrganization(orm, { slug: "acme", reason: "Closed" });

    expect(await orm.$count(session)).toBe(1);
    expect(await orm.$count(auditEvent, eq(auditEvent.action, "auth.sessions_revoked"))).toBe(0);
  });

  test("refuses an unknown slug and writes nothing", async ({ orm }) => {
    await createFirm(orm, "acme");
    const events = await orm.$count(auditEvent);

    await expect(deactivateOrganization(orm, { slug: "nope", reason: "Closed" })).rejects.toThrow(
      new CliError({
        code: "unknown_organization",
        message: `No organization has the slug "nope".`,
      }),
    );
    expect(await orm.$count(auditEvent)).toBe(events);
  });

  test("refuses a Firm already deactivated and writes nothing", async ({ orm }) => {
    await createFirm(orm, "acme");
    const first = await deactivateOrganization(orm, { slug: "acme", reason: "Closed" });
    const events = await orm.$count(auditEvent);

    const again = deactivateOrganization(orm, { slug: "acme", reason: "Again" });
    await expect(again).rejects.toBeInstanceOf(CliError);
    await expect(again).rejects.toMatchObject({
      code: "already_deactivated",
      message: expect.stringMatching(/already deactivated/),
    });
    expect(await deactivatedAt(orm, "acme")).toEqual(first.at);
    expect(await orm.$count(auditEvent)).toBe(events);
  });

  test("with dryRun, counts what it would cancel and writes nothing", async ({ orm }) => {
    const firm = await createFirm(orm, "acme");
    const pending = await seedInvitation(orm, { firmId: firm.id, email: "new@example.com" });
    const events = await orm.$count(auditEvent);

    const result = await deactivateOrganization(orm, {
      slug: "acme",
      reason: "Closed",
      dryRun: true,
    });

    expect(result).toEqual({
      publicId: firm.publicId,
      name: "acme",
      slug: "acme",
      at: expect.any(Date),
      canceledInvitations: 1,
      dryRun: true,
    });
    expect(await deactivatedAt(orm, "acme")).toBeNull();
    expect(
      await orm
        .select({ status: invitation.status })
        .from(invitation)
        .where(eq(invitation.publicId, pending)),
    ).toEqual([{ status: "pending" }]);
    expect(await orm.$count(auditEvent)).toBe(events);
  });

  test("with dryRun, refuses what a real run would", async ({ orm }) => {
    await createFirm(orm, "acme");
    await deactivateOrganization(orm, { slug: "acme", reason: "Closed" });

    await expect(
      deactivateOrganization(orm, { slug: "acme", reason: "Again", dryRun: true }),
    ).rejects.toMatchObject({ code: "already_deactivated" });
  });

  test.for(["", "   "])("refuses an empty reason (%j)", async (reason, { orm }) => {
    await createFirm(orm, "acme");
    await expect(deactivateOrganization(orm, { slug: "acme", reason })).rejects.toThrow(CliError);
    expect(await deactivatedAt(orm, "acme")).toBeNull();
  });
});

describe("reactivateOrganization", () => {
  test("clears deactivated_at and audits org.reactivated with no actor", async ({ orm }) => {
    const firm = await createFirm(orm, "acme");
    await deactivateOrganization(orm, { slug: "acme", reason: "Closed" });

    const result = await reactivateOrganization(orm, { slug: "acme", reason: "Back again" });

    expect(result).toMatchObject({ publicId: firm.publicId, slug: "acme" });
    expect(await deactivatedAt(orm, "acme")).toBeNull();
    expect((await statusEvents(orm)).at(-1)).toEqual({
      action: "org.reactivated",
      actorUserId: null,
      organizationId: firm.id,
      targetType: "organization",
      targetId: firm.publicId,
      metadata: { via: "cli", reason: "Back again" },
    });
  });

  test("leaves canceled invitations canceled", async ({ orm }) => {
    const firm = await createFirm(orm, "acme");
    await seedInvitation(orm, { firmId: firm.id, email: "new@example.com" });
    await deactivateOrganization(orm, { slug: "acme", reason: "Closed" });

    await reactivateOrganization(orm, { slug: "acme", reason: "Back" });

    expect(await orm.select({ status: invitation.status }).from(invitation)).toEqual([
      { status: "canceled" },
    ]);
  });

  test("refuses an active Firm and writes nothing", async ({ orm }) => {
    await createFirm(orm, "acme");
    const events = await orm.$count(auditEvent);

    await expect(
      reactivateOrganization(orm, { slug: "acme", reason: "Back" }),
    ).rejects.toMatchObject({
      code: "not_deactivated",
      message: expect.stringMatching(/isn't deactivated/),
    });
    expect(await orm.$count(auditEvent)).toBe(events);
  });

  test("refuses an unknown slug", async ({ orm }) => {
    await expect(
      reactivateOrganization(orm, { slug: "nope", reason: "Back" }),
    ).rejects.toMatchObject({ code: "unknown_organization" });
  });

  test("with dryRun, leaves the Firm deactivated and writes nothing", async ({ orm }) => {
    await createFirm(orm, "acme");
    const { at } = await deactivateOrganization(orm, { slug: "acme", reason: "Closed" });
    const events = await orm.$count(auditEvent);

    const result = await reactivateOrganization(orm, {
      slug: "acme",
      reason: "Back",
      dryRun: true,
    });

    expect(result).toMatchObject({ slug: "acme", dryRun: true });
    expect(await deactivatedAt(orm, "acme")).toEqual(at);
    expect(await orm.$count(auditEvent)).toBe(events);
  });
});

describe("a Deactivated Firm's records", () => {
  test("stay exactly as they were across deactivation and reactivation", async ({
    orm,
    migratorOrm,
  }) => {
    await seedFirm(migratorOrm, "acme");
    await seedFirm(migratorOrm, "globex");
    const before = await firmScopedRows(migratorOrm);

    await deactivateOrganization(orm, { slug: "acme", reason: "Closed" });
    expect(await firmScopedRows(migratorOrm)).toEqual(before);
    await reactivateOrganization(orm, { slug: "acme", reason: "Back" });
    expect(await firmScopedRows(migratorOrm)).toEqual(before);
  });
});

describe("withFirm on a Deactivated Firm", () => {
  test("refuses reads and writes, and works again after reactivation", async ({
    orm,
    migratorOrm,
  }) => {
    const acme = await seedFirm(migratorOrm, "acme");
    await deactivateOrganization(orm, { slug: "acme", reason: "Closed" });

    const read = withFirm(orm, { firmId: acme, query: (tx) => tx.select().from(household) });
    await expect(read).rejects.toBeInstanceOf(FirmDeactivatedError);
    await expect(read).rejects.toMatchObject({ firmId: acme });
    await expect(
      withFirm(orm, {
        firmId: acme,
        query: (tx) =>
          tx.insert(household).values({ firmId: acme, name: "New", relationshipStatus: "client" }),
      }),
    ).rejects.toBeInstanceOf(FirmDeactivatedError);
    expect(
      await migratorOrm.$count(
        household,
        and(eq(household.firmId, acme), eq(household.name, "New")),
      ),
    ).toBe(0);

    await reactivateOrganization(orm, { slug: "acme", reason: "Back" });
    expect(await withFirm(orm, { firmId: acme, query: (tx) => tx.$count(household) })).toBe(1);
  });

  test("still works for an active Firm", async ({ orm, migratorOrm }) => {
    const acme = await seedFirm(migratorOrm, "acme");
    await seedFirm(migratorOrm, "globex");
    await deactivateOrganization(orm, { slug: "globex", reason: "Closed" });

    expect(await withFirm(orm, { firmId: acme, query: (tx) => tx.$count(household) })).toBe(1);
  });
});
