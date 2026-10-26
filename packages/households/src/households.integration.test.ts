import { readFileSync } from "node:fs";
import type { Database } from "@repo/db";
import { household, organization } from "@repo/db/schema";
import { test } from "@repo/db/testing";
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
