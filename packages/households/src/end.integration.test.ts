import { readFileSync } from "node:fs";
import type { Database } from "@repo/db";
import {
  accountRole,
  accountRoleHistory,
  custodialAccount,
  household,
  householdMember,
  householdMemberHistory,
  organization,
  person,
  user,
} from "@repo/db/schema";
import { test } from "@repo/db/testing";
import { and, asc, eq } from "drizzle-orm";
import { endAccountRole, endHouseholdMembership } from "./end";
import { listHouseholds } from "./households";
import { getHouseholdOverview } from "./overview";
import { seedDevWorld } from "./seed";

// Well past world v0's roles, which start in early 2026, and before any test's clock.
const LEFT_ON = "2026-04-01";
const SYSTEM = { system: "test" };
// A UUIDv7 no row has, and text Postgres would refuse to compare with a `uuid`.
const UNKNOWN_IDS = ["01900000-0000-7000-8000-000000000000", "not-a-uuid"];

/** World v0 in the database, with the ids and `publicId`s these tests find rows by. */
const reyes = test.extend("reyes", async ({ orm, migratorOrm }) => {
  await seedDevWorld(
    orm,
    JSON.parse(readFileSync(new URL("../../../world/v0.json", import.meta.url), "utf8")),
  );
  const firms = await migratorOrm.select().from(organization);
  const [home] = await migratorOrm.select().from(household);
  const people = await migratorOrm.select().from(person);
  const personNamed = (firstName: string) => people.find((p) => p.firstName === firstName)!;
  return {
    firmId: firms.find((f) => f.slug === "larkspur")!.id,
    globexId: firms.find((f) => f.slug === "globex")!.id,
    home: home!,
    dana: personNamed("Dana"),
    jordan: personNamed("Jordan"),
  };
});

type RoleOfArgs = { personId: number; accountNumber: string };

/** The Account role `personId` holds on `accountNumber`, as stored. */
async function roleOf(db: Database, { personId, accountNumber }: RoleOfArgs) {
  const [row] = await db
    .select({ role: accountRole })
    .from(accountRole)
    .innerJoin(custodialAccount, eq(custodialAccount.id, accountRole.accountId))
    .where(
      and(eq(accountRole.personId, personId), eq(custodialAccount.accountNumber, accountNumber)),
    );
  return row!.role;
}

/** Every membership `personId` has, oldest first, as stored. */
function membershipsOf(db: Database, personId: number) {
  return db
    .select()
    .from(householdMember)
    .where(eq(householdMember.personId, personId))
    .orderBy(asc(householdMember.id));
}

describe("endAccountRole", () => {
  reyes(
    "sets the end date and keeps the old row with who ended it",
    async ({ orm, migratorOrm, reyes: { firmId, jordan } }) => {
      const [advisor] = await migratorOrm
        .insert(user)
        .values({ email: "ada@larkspur.test", name: "Ada", emailVerified: true })
        .returning();
      const before = await roleOf(migratorOrm, {
        personId: jordan.id,
        accountNumber: "CW-000002",
      });

      expect(
        await endAccountRole(orm, {
          firmId,
          actor: { userId: advisor!.id },
          publicId: before.publicId,
          endsOn: LEFT_ON,
        }),
      ).toEqual({ status: "ended" });

      const after = await roleOf(migratorOrm, { personId: jordan.id, accountNumber: "CW-000002" });
      expect(after).toEqual({ ...before, endsOn: LEFT_ON });
      expect(await migratorOrm.select().from(accountRoleHistory)).toEqual([
        {
          id: expect.any(Number),
          recordId: before.id,
          publicId: before.publicId,
          firmId,
          personId: jordan.id,
          accountId: before.accountId,
          role: "beneficiary",
          startsOn: "2026-03-02",
          endsOn: null,
          createdAt: before.createdAt,
          operation: "update",
          validUntil: expect.any(Date),
          changedByUserId: advisor!.id,
          changedByDeliveryId: null,
          changedBySystem: null,
        },
      ]);
    },
  );

  // Its first day is its last: not "before" its start, and nothing rejects it.
  reyes("ends a role on the day it started", async ({ orm, migratorOrm, reyes: r }) => {
    const { publicId, startsOn } = await roleOf(migratorOrm, {
      personId: r.jordan.id,
      accountNumber: "CW-000002",
    });

    expect(
      await endAccountRole(orm, { firmId: r.firmId, actor: SYSTEM, publicId, endsOn: startsOn }),
    ).toEqual({ status: "ended" });
  });

  reyes(
    "refuses a row already ended, and leaves its date and history alone",
    async ({ orm, migratorOrm, reyes: r }) => {
      const { publicId } = await roleOf(migratorOrm, {
        personId: r.jordan.id,
        accountNumber: "CW-000002",
      });
      const end = (endsOn: string) =>
        endAccountRole(orm, { firmId: r.firmId, actor: SYSTEM, publicId, endsOn });
      await end(LEFT_ON);

      expect(await end("2026-05-01")).toEqual({ status: "already_ended" });

      const { endsOn } = await roleOf(migratorOrm, {
        personId: r.jordan.id,
        accountNumber: "CW-000002",
      });
      expect(endsOn).toBe(LEFT_ON);
      expect(await migratorOrm.$count(accountRoleHistory)).toBe(1);
    },
  );

  reyes(
    "refuses a date before the role's start, and writes nothing",
    async ({ orm, migratorOrm, reyes: r }) => {
      const { publicId } = await roleOf(migratorOrm, {
        personId: r.jordan.id,
        accountNumber: "CW-000002",
      });

      expect(
        await endAccountRole(orm, {
          firmId: r.firmId,
          actor: SYSTEM,
          publicId,
          endsOn: "2026-03-01",
        }),
      ).toEqual({ status: "before_start" });

      const { endsOn } = await roleOf(migratorOrm, {
        personId: r.jordan.id,
        accountNumber: "CW-000002",
      });
      expect(endsOn).toBeNull();
      expect(await migratorOrm.$count(accountRoleHistory)).toBe(0);
    },
  );

  reyes("knows no role of another Firm", async ({ orm, migratorOrm, reyes: r }) => {
    const { publicId } = await roleOf(migratorOrm, {
      personId: r.jordan.id,
      accountNumber: "CW-000002",
    });

    expect(
      await endAccountRole(orm, {
        firmId: r.globexId,
        actor: SYSTEM,
        publicId,
        endsOn: LEFT_ON,
      }),
    ).toEqual({ status: "not_found" });

    const { endsOn } = await roleOf(migratorOrm, {
      personId: r.jordan.id,
      accountNumber: "CW-000002",
    });
    expect(endsOn).toBeNull();
  });

  reyes.for(UNKNOWN_IDS)("knows no role %s", async (publicId, { orm, reyes: r }) => {
    expect(
      await endAccountRole(orm, { firmId: r.firmId, actor: SYSTEM, publicId, endsOn: LEFT_ON }),
    ).toEqual({ status: "not_found" });
  });
});

describe("endHouseholdMembership", () => {
  reyes(
    "sets the end date and keeps the old row with who ended it",
    async ({ orm, migratorOrm, reyes: { firmId, home, jordan } }) => {
      const [before] = await membershipsOf(migratorOrm, jordan.id);

      expect(
        await endHouseholdMembership(orm, {
          firmId,
          actor: SYSTEM,
          householdPublicId: home.publicId,
          personPublicId: jordan.publicId,
          endsOn: LEFT_ON,
        }),
      ).toEqual({ status: "ended" });

      expect(await membershipsOf(migratorOrm, jordan.id)).toEqual([{ ...before, endsOn: LEFT_ON }]);
      expect(await migratorOrm.select().from(householdMemberHistory)).toEqual([
        {
          id: expect.any(Number),
          recordId: before!.id,
          publicId: before!.publicId,
          firmId,
          householdId: home.id,
          personId: jordan.id,
          role: "co_client",
          startsOn: "2026-02-26",
          endsOn: null,
          createdAt: before!.createdAt,
          operation: "update",
          validUntil: expect.any(Date),
          changedByUserId: null,
          changedByDeliveryId: null,
          changedBySystem: "test",
        },
      ]);
    },
  );

  reyes(
    "lets another Person become Primary once the Primary has left",
    async ({ orm, migratorOrm, reyes: { firmId, home, dana, jordan } }) => {
      await endHouseholdMembership(orm, {
        firmId,
        actor: SYSTEM,
        householdPublicId: home.publicId,
        personPublicId: dana.publicId,
        endsOn: LEFT_ON,
      });
      await endHouseholdMembership(orm, {
        firmId,
        actor: SYSTEM,
        householdPublicId: home.publicId,
        personPublicId: jordan.publicId,
        endsOn: LEFT_ON,
      });

      await migratorOrm.insert(householdMember).values({
        firmId,
        householdId: home.id,
        personId: jordan.id,
        role: "primary",
        startsOn: LEFT_ON,
      });

      const overview = await getHouseholdOverview(orm, { firmId, publicId: home.publicId });
      expect(overview?.people.map((p) => `${p.firstName} ${p.householdRole}`)).toEqual([
        "Jordan primary",
      ]);
    },
  );

  reyes(
    "lets a Person who left rejoin, and ends the row that holds",
    async ({ orm, migratorOrm, reyes: { firmId, home, jordan } }) => {
      const end = (endsOn: string) =>
        endHouseholdMembership(orm, {
          firmId,
          actor: SYSTEM,
          householdPublicId: home.publicId,
          personPublicId: jordan.publicId,
          endsOn,
        });
      await end(LEFT_ON);
      await migratorOrm.insert(householdMember).values({
        firmId,
        householdId: home.id,
        personId: jordan.id,
        role: "dependent",
        startsOn: "2026-04-15",
      });

      expect(await end("2026-05-01")).toEqual({ status: "ended" });

      expect((await membershipsOf(migratorOrm, jordan.id)).map((row) => row.endsOn)).toEqual([
        LEFT_ON,
        "2026-05-01",
      ]);
    },
  );

  reyes(
    "refuses a membership already ended, and leaves its date and history alone",
    async ({ orm, migratorOrm, reyes: { firmId, home, jordan } }) => {
      const end = (endsOn: string) =>
        endHouseholdMembership(orm, {
          firmId,
          actor: SYSTEM,
          householdPublicId: home.publicId,
          personPublicId: jordan.publicId,
          endsOn,
        });
      await end(LEFT_ON);

      expect(await end("2026-05-01")).toEqual({ status: "already_ended" });

      expect((await membershipsOf(migratorOrm, jordan.id)).map((row) => row.endsOn)).toEqual([
        LEFT_ON,
      ]);
      expect(await migratorOrm.$count(householdMemberHistory)).toBe(1);
    },
  );

  reyes(
    "refuses a date before the membership's start, and writes nothing",
    async ({ orm, migratorOrm, reyes: { firmId, home, jordan } }) => {
      expect(
        await endHouseholdMembership(orm, {
          firmId,
          actor: SYSTEM,
          householdPublicId: home.publicId,
          personPublicId: jordan.publicId,
          endsOn: "2026-02-25",
        }),
      ).toEqual({ status: "before_start" });

      expect((await membershipsOf(migratorOrm, jordan.id)).map((row) => row.endsOn)).toEqual([
        null,
      ]);
      expect(await migratorOrm.$count(householdMemberHistory)).toBe(0);
    },
  );

  reyes(
    "knows no Household or Person of another Firm",
    async ({ orm, migratorOrm, reyes: { globexId, home, jordan } }) => {
      expect(
        await endHouseholdMembership(orm, {
          firmId: globexId,
          actor: SYSTEM,
          householdPublicId: home.publicId,
          personPublicId: jordan.publicId,
          endsOn: LEFT_ON,
        }),
      ).toEqual({ status: "not_found" });

      expect((await membershipsOf(migratorOrm, jordan.id)).map((row) => row.endsOn)).toEqual([
        null,
      ]);
    },
  );

  reyes(
    "knows no membership of a Person outside the Household",
    async ({ orm, migratorOrm, reyes: { firmId, home } }) => {
      const [stranger] = await migratorOrm
        .insert(person)
        .values({ firmId, firstName: "Sam", lastName: "Ortiz", bornOn: "2015-06-01" })
        .returning();

      expect(
        await endHouseholdMembership(orm, {
          firmId,
          actor: SYSTEM,
          householdPublicId: home.publicId,
          personPublicId: stranger!.publicId,
          endsOn: LEFT_ON,
        }),
      ).toEqual({ status: "not_found" });
    },
  );

  reyes.for(UNKNOWN_IDS)(
    "knows no Household or Person %s",
    async (unknown, { orm, reyes: { firmId, home, jordan } }) => {
      const end = (ids: { householdPublicId: string; personPublicId: string }) =>
        endHouseholdMembership(orm, { firmId, actor: SYSTEM, endsOn: LEFT_ON, ...ids });

      expect(await end({ householdPublicId: unknown, personPublicId: jordan.publicId })).toEqual({
        status: "not_found",
      });
      expect(await end({ householdPublicId: home.publicId, personPublicId: unknown })).toEqual({
        status: "not_found",
      });
    },
  );

  reyes(
    "takes the Person out of the Household list and overview, with the Accounts they owned only through it",
    async ({ orm, migratorOrm, reyes: { firmId, home, dana, jordan } }) => {
      // Dana alone holds an Account of her own besides the seeded joint one.
      const [solo] = await migratorOrm
        .insert(custodialAccount)
        .values({ firmId, accountNumber: "CW-000009" })
        .returning();
      await migratorOrm.insert(accountRole).values({
        firmId,
        personId: dana.id,
        accountId: solo!.id,
        role: "owner",
        startsOn: "2026-01-02",
      });

      await endHouseholdMembership(orm, {
        firmId,
        actor: SYSTEM,
        householdPublicId: home.publicId,
        personPublicId: dana.publicId,
        endsOn: LEFT_ON,
      });

      const overview = await getHouseholdOverview(orm, { firmId, publicId: home.publicId });
      expect(overview?.people.map((p) => p.firstName)).toEqual(["Jordan"]);
      // Jordan still jointly owns CW-000001, which still names Dana; Dana's own two have gone.
      expect(
        overview?.accounts.map(({ accountNumberEnding, roles }) => ({
          accountNumberEnding,
          roles: roles.map((r) => `${r.person.firstName} ${r.role}`),
        })),
      ).toEqual([
        { accountNumberEnding: "0001", roles: ["Jordan joint_owner", "Dana joint_owner"] },
      ]);

      const [listed] = await listHouseholds(orm, firmId);
      expect(listed?.people.map((p) => p.publicId)).toEqual([jordan.publicId]);
    },
  );
});
