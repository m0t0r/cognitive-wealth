import { RegistrationType, SecurityKind, TransactionKind } from "@repo/custodian-client/schemas";
import { eq, sql } from "drizzle-orm";
import type { Database } from "./index";
import {
  accountRole,
  auditEvent,
  custodialAccount,
  custodialPosition,
  custodialTransaction,
  custodianDelivery,
  household,
  householdMember,
  invitation,
  member,
  organization,
  person,
  security,
  securityPrice,
  session,
  user,
} from "./schema";
import { test } from "./testing";

// Postgres SQLSTATEs, checked on the driver error Drizzle wraps as `cause`.
const GENERATED_ALWAYS = { cause: { code: "428C9" } };
const FOREIGN_KEY_VIOLATION = { cause: { code: "23503" } };
const RESTRICT_VIOLATION = { cause: { code: "23001" } };
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

async function createSession(
  db: Database,
  { userId, activeOrganizationId }: { userId: number; activeOrganizationId?: number },
) {
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

async function createInvitation(
  db: Database,
  { organizationId, inviterId }: { organizationId: number; inviterId: number },
) {
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
    const inv = await createInvitation(orm, { organizationId: org.id, inviterId: u.id });

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
    const created = await createSession(orm, { userId: u.id, activeOrganizationId: org.id });

    const [row] = await orm
      .select({ activeOrganizationId: session.activeOrganizationId })
      .from(session)
      .where(eq(session.id, created.id));
    expect(row).toEqual({ activeOrganizationId: String(org.id) });
  });

  test("is nulled when its organization is deleted", async ({ orm }) => {
    const u = await createUser(orm);
    const org = await createOrganization(orm);
    const created = await createSession(orm, { userId: u.id, activeOrganizationId: org.id });

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
    const invited = await createInvitation(orm, { organizationId: acme.id, inviterId: ada.id });
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
    await createSession(orm, { userId: u.id, activeOrganizationId: org.id });
    await orm.insert(member).values({ organizationId: org.id, userId: u.id, role: "owner" });
    await createInvitation(orm, { organizationId: org.id, inviterId: u.id });
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
  test("removes its members and invitations, and keeps users", async ({ orm }) => {
    const u = await createUser(orm);
    const org = await createOrganization(orm);
    await orm.insert(member).values({ organizationId: org.id, userId: u.id, role: "owner" });
    await createInvitation(orm, { organizationId: org.id, inviterId: u.id });

    await orm.delete(organization).where(eq(organization.id, org.id));

    expect(await orm.$count(member)).toBe(0);
    expect(await orm.$count(invitation)).toBe(0);
    expect(await orm.$count(user)).toBe(1);
  });

  // Records are kept (ADR 0021), and an event must keep saying whose it was.
  test("fails while it has audit events", async ({ orm }) => {
    const org = await createOrganization(orm);
    await orm.insert(auditEvent).values({ action: "org.switched", organizationId: org.id });

    await expect(orm.delete(organization).where(eq(organization.id, org.id))).rejects.toMatchObject(
      RESTRICT_VIOLATION,
    );
    expect(
      await orm.select({ organizationId: auditEvent.organizationId }).from(auditEvent),
    ).toEqual([{ organizationId: org.id }]);
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

// The Firm-scoped tables' own constraints, written as `migrator`, which owns the tables and so
// isn't held by their row-level security (that's firm-isolation.integration.test.ts).
describe("households", () => {
  test("can't link rows from different Firms", async ({ migratorOrm: orm }) => {
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

  test("have one Primary, at most one Co-client and any number of Dependents", async ({
    migratorOrm: orm,
  }) => {
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

  // The migrations froze the list; the Custodian's contract can grow. A new Registration type in
  // openapi.json fails this until a migration widens the check (Ingestion would fail on it).
  test("accept every Registration type the Custodian's contract has, and no others", async ({
    migratorOrm: orm,
  }) => {
    const [constraintRow] = await orm.execute<{ definition: string }>(
      sql`select pg_get_constraintdef(oid) as definition from pg_constraint
          where conname = 'custodial_account_registration_type_check'`,
    );
    const allowed = [...constraintRow!.definition.matchAll(/'([^']+)'::text/g)].map((m) => m[1]);

    expect(new Set(allowed)).toEqual(new Set(RegistrationType.options));
  });

  test("hold only known statuses, registration types and roles", async ({ migratorOrm: orm }) => {
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
});

/** A Firm with an Account, a Security and an ingested Delivery to hang feed rows on. */
async function createFeedFirm(db: Database, slug: string) {
  const firm = await createOrganization(db, slug);
  const [account] = await db
    .insert(custodialAccount)
    .values({ firmId: firm.id, accountNumber: "CW-000001" })
    .returning();
  const [fund] = await db
    .insert(security)
    .values({ firmId: firm.id, identifier: "LKSF", name: "Larkspur Stock Fund", kind: "fund" })
    .returning();
  const [delivery] = await db
    .insert(custodianDelivery)
    .values({ firmId: firm.id, asOfDate: "2026-03-02", manifestSha256: "0".repeat(64) })
    .returning();
  return {
    firmId: firm.id,
    accountId: account!.id,
    securityId: fund!.id,
    deliveryId: delivery!.id,
  };
}

type Feed = Awaited<ReturnType<typeof createFeedFirm>>;

const buy = (feed: Feed) => ({
  ...feed,
  transactionId: "TX-000000004",
  kind: "buy" as const,
  shares: "40.000000",
  amount: "-6010.00",
  tradeDate: "2026-03-02",
  settlementDate: "2026-03-03",
  postingDate: "2026-03-02",
});

describe("custodian feed", () => {
  test("keeps amounts at their type's scale, and a price as quoted", async ({
    migratorOrm: orm,
  }) => {
    const feed = await createFeedFirm(orm, "larkspur");

    const [row] = await orm
      .insert(custodialTransaction)
      .values({ ...buy(feed), shares: "40.5", amount: "-6010" })
      .returning();
    const [quote] = await orm
      .insert(securityPrice)
      .values({ ...feed, asOfDate: "2026-03-02", price: "150.2500" })
      .returning();

    expect(row).toMatchObject({ shares: "40.500000", amount: "-6010.00" });
    expect(quote!.price).toBe("150.2500");
  });

  // The second guard against loading a Delivery twice (docs/learn/03, Part 5).
  test("hold each Transaction ID once per Firm", async ({ migratorOrm: orm }) => {
    const larkspur = await createFeedFirm(orm, "larkspur");
    const globex = await createFeedFirm(orm, "globex");
    await orm.insert(custodialTransaction).values(buy(larkspur));

    await expect(orm.insert(custodialTransaction).values(buy(larkspur))).rejects.toMatchObject(
      UNIQUE_VIOLATION,
    );
    await orm.insert(custodialTransaction).values(buy(globex));
  });

  test("hold one Delivery per Firm and As-of date", async ({ migratorOrm: orm }) => {
    const { firmId } = await createFeedFirm(orm, "larkspur");

    await expect(
      orm
        .insert(custodianDelivery)
        .values({ firmId, asOfDate: "2026-03-02", manifestSha256: "1".repeat(64) }),
    ).rejects.toMatchObject(UNIQUE_VIOLATION);
  });

  test("can't point at another Firm's Account, Security or Delivery", async ({
    migratorOrm: orm,
  }) => {
    const larkspur = await createFeedFirm(orm, "larkspur");
    const globex = await createFeedFirm(orm, "globex");
    const strangers = [
      { accountId: globex.accountId },
      { securityId: globex.securityId },
      { deliveryId: globex.deliveryId },
    ];

    await Promise.all(
      strangers.map((stranger) =>
        expect(
          orm.insert(custodialTransaction).values({ ...buy(larkspur), ...stranger }),
        ).rejects.toMatchObject(FOREIGN_KEY_VIOLATION),
      ),
    );
    await expect(
      orm.insert(custodialPosition).values({
        ...larkspur,
        accountId: globex.accountId,
        asOfDate: "2026-03-02",
        shares: "40.000000",
      }),
    ).rejects.toMatchObject(FOREIGN_KEY_VIOLATION);
  });

  // A past report must be reproducible from the rows it used (ADR 0009).
  test("keep an Account's history: it can't be deleted while it has any", async ({
    migratorOrm: orm,
  }) => {
    const feed = await createFeedFirm(orm, "larkspur");
    await orm.insert(custodialTransaction).values(buy(feed));

    await expect(
      orm.delete(custodialAccount).where(eq(custodialAccount.id, feed.accountId)),
    ).rejects.toMatchObject(FOREIGN_KEY_VIOLATION);
  });

  // As with Registration types: the contract can grow, and the migrations froze the lists.
  test.for([
    { constraint: "security_kind_check", options: SecurityKind.options },
    { constraint: "custodial_transaction_kind_check", options: TransactionKind.options },
  ])(
    "$constraint accepts the contract's kinds, and no others",
    async ({ constraint, options }, { migratorOrm: orm }) => {
      const [constraintRow] = await orm.execute<{ definition: string }>(
        sql`select pg_get_constraintdef(oid) as definition from pg_constraint
            where conname = ${constraint}`,
      );
      const allowed = [...constraintRow!.definition.matchAll(/'([^']+)'::text/g)].map((m) => m[1]);

      expect(new Set(allowed)).toEqual(new Set(options));
    },
  );

  // Records are kept (ADR 0021): a Delivery can't take what it carried with it.
  test.for([
    {
      table: "custodial_transaction",
      insert: (db: Database, feed: Feed) => db.insert(custodialTransaction).values(buy(feed)),
    },
    {
      table: "custodial_position",
      insert: (db: Database, feed: Feed) =>
        db
          .insert(custodialPosition)
          .values({ ...feed, asOfDate: "2026-03-02", shares: "40.000000" }),
    },
    {
      table: "security_price",
      insert: (db: Database, feed: Feed) =>
        db.insert(securityPrice).values({ ...feed, asOfDate: "2026-03-02", price: "150.25" }),
    },
  ])(
    "a Delivery with rows in $table can't be deleted",
    async ({ insert }, { migratorOrm: orm }) => {
      const feed = await createFeedFirm(orm, "larkspur");
      await insert(orm, feed);

      await expect(
        orm.delete(custodianDelivery).where(eq(custodianDelivery.id, feed.deliveryId)),
      ).rejects.toMatchObject(RESTRICT_VIOLATION);
      expect(await orm.$count(custodianDelivery)).toBe(1);
    },
  );

  test("a Delivery that carried no rows can be deleted", async ({ migratorOrm: orm }) => {
    const feed = await createFeedFirm(orm, "larkspur");

    await orm.delete(custodianDelivery).where(eq(custodianDelivery.id, feed.deliveryId));

    expect(await orm.$count(custodianDelivery)).toBe(0);
  });
});
