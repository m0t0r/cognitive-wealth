import { readFileSync } from "node:fs";
import type { Database } from "@repo/db";
import { accountRole, household, householdMember, organization, person } from "@repo/db/schema";
import { test } from "@repo/db/testing";
import { asc, eq } from "drizzle-orm";
import { endAccountRole, endHouseholdMembership } from "./end";
import { listHouseholds } from "./households";
import { z } from "zod";
import { seedDevWorld } from "./seed";

// A `publicId`: the database defaults it to `uuidv7()`.
const UUID = expect.schemaMatching(z.uuidv7());

async function seededFirms(db: Database) {
  await seedDevWorld(
    db,
    JSON.parse(readFileSync(new URL("../../../world/v0.json", import.meta.url), "utf8")),
  );
  const firms = await db
    .select({ id: organization.id, slug: organization.slug })
    .from(organization);
  const idOf = (slug: string) => firms.find((f) => f.slug === slug)!.id;
  return { larkspur: idOf("larkspur"), globex: idOf("globex") };
}

describe("listHouseholds", () => {
  test("gives a Firm's Households with their People and Accounts, by publicId only", async ({
    orm,
  }) => {
    const { larkspur } = await seededFirms(orm);

    const households = await listHouseholds(orm, larkspur);

    const account = (accountNumber: string) => ({
      publicId: UUID,
      accountNumber,
      registrationType: null,
    });
    expect(households).toEqual([
      {
        publicId: UUID,
        name: "The Reyes Household",
        relationshipStatus: "client",
        people: [
          {
            publicId: UUID,
            firstName: "Dana",
            lastName: "Reyes",
            bornOn: "1978-05-14",
            householdRole: "primary",
            accountRoles: [
              { account: account("CW-000001"), role: "joint_owner", startsOn: "2026-02-26" },
              { account: account("CW-000002"), role: "owner", startsOn: "2026-03-02" },
            ],
          },
          {
            publicId: UUID,
            firstName: "Jordan",
            lastName: "Reyes",
            bornOn: "1980-09-02",
            householdRole: "co_client",
            accountRoles: [
              { account: account("CW-000001"), role: "joint_owner", startsOn: "2026-02-26" },
              { account: account("CW-000002"), role: "beneficiary", startsOn: "2026-03-02" },
            ],
          },
        ],
      },
    ]);
    // Both People hold roles on the same two Accounts.
    const [dana, jordan] = households[0]!.people;
    expect(jordan!.accountRoles.map((r) => r.account)).toEqual(
      dana!.accountRoles.map((r) => r.account),
    );
  });

  // The hold rule (#192), with today as its date: an end date is the first day a row doesn't hold.
  test("shows only the memberships and Account roles that hold today", async ({
    orm,
    migratorOrm,
  }) => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-04-15T12:00:00Z") });
    // The shared config restores mocks, envs and globals, not timers.
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const { larkspur } = await seededFirms(orm);
    const [home] = await migratorOrm.select().from(household);
    const [dana, jordan] = await migratorOrm.select().from(person).orderBy(asc(person.id));
    const roles = await migratorOrm
      .select()
      .from(accountRole)
      .where(eq(accountRole.personId, dana!.id))
      .orderBy(asc(accountRole.startsOn));
    const actor = { system: "test" };
    // Ended today, so it no longer holds; ended tomorrow, so it still does.
    await endAccountRole(orm, {
      firmId: larkspur,
      actor,
      publicId: roles[0]!.publicId,
      endsOn: "2026-04-15",
    });
    await endAccountRole(orm, {
      firmId: larkspur,
      actor,
      publicId: roles[1]!.publicId,
      endsOn: "2026-04-16",
    });
    await endHouseholdMembership(orm, {
      firmId: larkspur,
      actor,
      householdPublicId: home!.publicId,
      personPublicId: jordan!.publicId,
      endsOn: "2026-04-15",
    });
    // Joins, and takes a role, only tomorrow.
    await migratorOrm.insert(householdMember).values({
      firmId: larkspur,
      householdId: home!.id,
      personId: jordan!.id,
      role: "dependent",
      startsOn: "2026-04-16",
    });
    await migratorOrm.insert(accountRole).values({
      firmId: larkspur,
      personId: dana!.id,
      accountId: roles[0]!.accountId,
      role: "owner",
      startsOn: "2026-04-16",
    });

    const [listed] = await listHouseholds(orm, larkspur);

    expect(
      listed?.people.map(({ firstName, accountRoles }) => ({
        firstName,
        roles: accountRoles.map((r) => r.role),
      })),
    ).toEqual([{ firstName: "Dana", roles: ["owner"] }]);
    // The one left is the role ending tomorrow, on CW-000002.
    expect(listed?.people[0]?.accountRoles[0]?.account.accountNumber).toBe("CW-000002");
  });

  test("leaves out other Firms' Households", async ({ orm, migratorOrm }) => {
    const { larkspur, globex } = await seededFirms(orm);
    await migratorOrm
      .insert(household)
      .values({ firmId: globex, name: "Globex Household", relationshipStatus: "prospect" });

    expect((await listHouseholds(orm, larkspur)).map((h) => h.name)).toEqual([
      "The Reyes Household",
    ]);
    expect(await listHouseholds(orm, globex)).toEqual([
      {
        publicId: UUID,
        name: "Globex Household",
        relationshipStatus: "prospect",
        people: [],
      },
    ]);
  });
});
