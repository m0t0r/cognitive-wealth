import { eq, sql } from "drizzle-orm";
import type { Database } from "./index";
import {
  accountRole,
  auditEvent,
  custodialAccount,
  household,
  householdMember,
  invitation,
  member,
  organization,
  person,
  session,
  user,
} from "./schema";
import { test } from "./testing";

// Postgres SQLSTATEs, checked on the driver error Drizzle wraps as `cause`.
const GENERATED_ALWAYS = { cause: { code: "428C9" } };
const FOREIGN_KEY_VIOLATION = { cause: { code: "23503" } };
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

describe("roles", () => {
  test("hold exactly one known role, on members and invitations", async ({ orm }) => {
    const ada = await createUser(orm);
    const acme = await createOrganization(orm);
    const invited = await createInvitation(orm, acme.id, ada.id);
    // Better Auth would store several roles comma-separated; one role per row is the rule.
    for (const role of ["owner,admin", "superuser", "Owner"]) {
      // Sequential on purpose: each insert is checked on its own.
      // oxlint-disable-next-line no-await-in-loop
      await expect(
        orm.insert(member).values({ organizationId: acme.id, userId: ada.id, role }),
      ).rejects.toMatchObject(CHECK_VIOLATION);
      // oxlint-disable-next-line no-await-in-loop
      await expect(
        orm.update(invitation).set({ role }).where(eq(invitation.id, invited.id)),
      ).rejects.toMatchObject(CHECK_VIOLATION);
    }
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

async function createHousehold(db: Database, firmId: number) {
  const [row] = await db
    .insert(household)
    .values({ firmId, name: "The Reyes Household", relationshipStatus: "client" })
    .returning();
  return row!;
}

async function createPerson(db: Database, firmId: number) {
  const [row] = await db
    .insert(person)
    .values({ firmId, firstName: "Dana", lastName: "Reyes", bornOn: "1978-05-14" })
    .returning();
  return row!;
}

describe("households", () => {
  test("can't link rows from different Firms", async ({ orm }) => {
    const larkspur = await createOrganization(orm, "larkspur");
    const globex = await createOrganization(orm, "globex");
    const home = await createHousehold(orm, larkspur.id);
    const stranger = await createPerson(orm, globex.id);
    const [account] = await orm
      .insert(custodialAccount)
      .values({ firmId: larkspur.id, accountNumber: "CW-000001", registrationType: "joint" })
      .returning();

    await expect(
      orm.insert(householdMember).values({
        firmId: larkspur.id,
        householdId: home.id,
        personId: stranger.id,
        role: "primary",
      }),
    ).rejects.toMatchObject(FOREIGN_KEY_VIOLATION);
    await expect(
      orm.insert(accountRole).values({
        firmId: globex.id,
        personId: stranger.id,
        accountId: account!.id,
        role: "owner",
        startsOn: "2026-02-26",
      }),
    ).rejects.toMatchObject(FOREIGN_KEY_VIOLATION);
  });

  test("have one Primary, at most one Co-client and any number of Dependents", async ({ orm }) => {
    const firm = await createOrganization(orm);
    const home = await createHousehold(orm, firm.id);
    const add = async (role: "primary" | "co_client" | "dependent") => {
      const { id: personId } = await createPerson(orm, firm.id);
      return orm
        .insert(householdMember)
        .values({ firmId: firm.id, householdId: home.id, personId, role });
    };

    await add("primary");
    await add("co_client");
    await add("dependent");
    await add("dependent");
    await expect(add("primary")).rejects.toMatchObject(UNIQUE_VIOLATION);
    await expect(add("co_client")).rejects.toMatchObject(UNIQUE_VIOLATION);
  });

  test("hold only known statuses, registration types and roles", async ({ orm }) => {
    const firm = await createOrganization(orm);
    const { id: personId } = await createPerson(orm, firm.id);
    const home = await createHousehold(orm, firm.id);
    const [account] = await orm
      .insert(custodialAccount)
      .values({ firmId: firm.id, accountNumber: "CW-000001", registrationType: "joint" })
      .returning();

    const statements = [
      sql`insert into household (firm_id, name, relationship_status) values (${firm.id}, 'X', 'lead')`,
      sql`insert into custodial_account (firm_id, account_number, registration_type) values (${firm.id}, 'CW-2', '401k')`,
      sql`insert into household_member (firm_id, household_id, person_id, role) values (${firm.id}, ${home.id}, ${personId}, 'spouse')`,
      sql`insert into account_role (firm_id, person_id, account_id, role, starts_on) values (${firm.id}, ${personId}, ${account!.id}, 'trustee', '2026-01-01')`,
    ];
    await Promise.all(
      statements.map((statement) =>
        expect(orm.execute(statement)).rejects.toMatchObject(CHECK_VIOLATION),
      ),
    );
  });

  test("go when their Firm is deleted", async ({ orm }) => {
    const firm = await createOrganization(orm);
    const home = await createHousehold(orm, firm.id);
    const { id: personId } = await createPerson(orm, firm.id);
    await orm
      .insert(householdMember)
      .values({ firmId: firm.id, householdId: home.id, personId, role: "primary" });

    await orm.delete(organization).where(eq(organization.id, firm.id));

    expect(await orm.$count(household)).toBe(0);
    expect(await orm.$count(person)).toBe(0);
    expect(await orm.$count(householdMember)).toBe(0);
  });
});
