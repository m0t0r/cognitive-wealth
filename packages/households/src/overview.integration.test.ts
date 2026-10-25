import { readFileSync } from "node:fs";
import type { Database } from "@repo/db";
import {
  accountRole,
  custodialAccount,
  custodialPosition,
  custodianDelivery,
  household,
  householdMember,
  organization,
  person,
  security,
} from "@repo/db/schema";
import { test } from "@repo/db/testing";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getHouseholdOverview } from "./overview";
import { seedDevWorld } from "./seed";

// A `publicId`: the database defaults it to `uuidv7()`.
const UUID = expect.schemaMatching(z.uuidv7());

// The Positions of the Custodian's example Deliveries for world file v0
// (apps/custodian/fixtures/feed/<date>/positions.csv), as Ingestion (#40) stores them. Ingestion
// lives in @repo/portfolio, which depends on this package, so the rows are written directly here.
const POSITIONS = {
  "2026-03-02": [
    ["CW-000001", "LKBF", "300.000000", "10.00", "3000.00"],
    ["CW-000001", "LKSF", "40.000000", "150.25", "6010.00"],
    ["CW-000001", "SWEEP", "5990.000000", "1.00", "5990.00"],
    ["CW-000002", "LKSF", "20.000000", "150.25", "3005.00"],
    ["CW-000002", "SWEEP", "2995.000000", "1.00", "2995.00"],
  ],
  "2026-03-06": [
    ["CW-000001", "LKBF", "300.000000", "10.02", "3006.00"],
    ["CW-000001", "LKSF", "30.000000", "153.40", "4602.00"],
    ["CW-000001", "SWEEP", "6476.650000", "1.00", "6476.65"],
    ["CW-000002", "LKSF", "20.000000", "153.40", "3068.00"],
    ["CW-000002", "SWEEP", "2995.000000", "1.00", "2995.00"],
  ],
} as const;

const SECURITIES = [
  { identifier: "LKBF", name: "Larkspur Bond Fund", kind: "fund" },
  { identifier: "LKSF", name: "Larkspur Stock Fund", kind: "fund" },
  { identifier: "SWEEP", name: "Larkspur Bank Sweep", kind: "cash_sweep" },
] as const;

/** The database `pnpm db:seed` gives, with the Firm ids by slug. */
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

/** The Larkspur Household's `publicId`. */
async function reyesPublicId(db: Database) {
  const [row] = await db.select({ publicId: household.publicId }).from(household);
  return row!.publicId;
}

/** The example Deliveries' Accounts, Securities and Positions for `asOfs`, as Ingestion stores them. */
async function ingested(
  db: Database,
  { firmId, asOfs }: { firmId: number; asOfs: Array<keyof typeof POSITIONS> },
) {
  await db
    .update(custodialAccount)
    .set({ registrationType: "joint", openedOn: "2026-02-26" })
    .where(eq(custodialAccount.accountNumber, "CW-000001"));
  await db
    .update(custodialAccount)
    .set({ registrationType: "traditional_ira", openedOn: "2026-03-02" })
    .where(eq(custodialAccount.accountNumber, "CW-000002"));
  const accounts = await db.select().from(custodialAccount);
  const securities = await db
    .insert(security)
    .values(SECURITIES.map((row) => ({ ...row, firmId })))
    .returning();
  const deliveries = await db
    .insert(custodianDelivery)
    .values(asOfs.map((asOf) => ({ firmId, asOfDate: asOf, manifestSha256: `sha-${asOf}` })))
    .returning();
  await db.insert(custodialPosition).values(
    deliveries.flatMap((delivery) =>
      new Map(Object.entries(POSITIONS))
        .get(delivery.asOfDate)!
        .map(([accountNumber, identifier, shares, price, marketValue]) => ({
          firmId,
          deliveryId: delivery.id,
          asOfDate: delivery.asOfDate,
          accountId: accounts.find((a) => a.accountNumber === accountNumber)!.id,
          securityId: securities.find((s) => s.identifier === identifier)!.id,
          shares,
          price,
          marketValue,
        })),
    ),
  );
}

type HouseholdOfGraceArgs = {
  firmId: number;
  jordanRole: "beneficiary" | "power_of_attorney" | "custodian";
  /** When both roles on the IRA start. */
  startsOn?: string;
};

/**
 * Jordan Reyes's mother Grace in a Household of her own, owning an IRA (CW-000003) that names
 * Jordan with `jordanRole`. Returns her Household's `publicId`.
 */
async function householdOfGrace(
  db: Database,
  { firmId, jordanRole, startsOn = "2020-01-02" }: HouseholdOfGraceArgs,
) {
  const [hers] = await db
    .insert(household)
    .values({ firmId, name: "The Grace Reyes Household", relationshipStatus: "client" })
    .returning();
  const [grace] = await db
    .insert(person)
    .values({ firmId, firstName: "Grace", lastName: "Reyes", bornOn: "1952-01-20" })
    .returning();
  const [jordan] = await db.select().from(person).where(eq(person.firstName, "Jordan"));
  await db
    .insert(householdMember)
    .values({ firmId, householdId: hers!.id, personId: grace!.id, role: "primary" });
  const [ira] = await db
    .insert(custodialAccount)
    .values({ firmId, accountNumber: "CW-000003" })
    .returning();
  await db.insert(accountRole).values([
    { firmId, personId: grace!.id, accountId: ira!.id, role: "owner", startsOn },
    { firmId, personId: jordan!.id, accountId: ira!.id, role: jordanRole, startsOn },
  ]);
  return hers!.publicId;
}

describe("getHouseholdOverview", () => {
  test("gives the Household, its People and its Accounts with the latest As-of date's Positions", async ({
    orm,
  }) => {
    const { larkspur } = await seededFirms(orm);
    await ingested(orm, { firmId: larkspur, asOfs: ["2026-03-02", "2026-03-06"] });
    const publicId = await reyesPublicId(orm);

    const overview = await getHouseholdOverview(orm, { firmId: larkspur, publicId });

    const dana = { publicId: UUID, firstName: "Dana", lastName: "Reyes" };
    const jordan = { publicId: UUID, firstName: "Jordan", lastName: "Reyes" };
    const position = (
      identifier: string,
      { shares, price, marketValue }: { shares: string; price: string; marketValue: string },
    ) => {
      const { name } = SECURITIES.find((s) => s.identifier === identifier)!;
      return {
        publicId: UUID,
        security: { publicId: UUID, identifier, name },
        shares,
        price,
        marketValue,
      };
    };
    expect(overview).toEqual({
      publicId,
      name: "The Reyes Household",
      relationshipStatus: "client",
      asOf: "2026-03-06",
      people: [
        { ...dana, householdRole: "primary" },
        { ...jordan, householdRole: "co_client" },
      ],
      accounts: [
        {
          publicId: UUID,
          accountNumberEnding: "0001",
          registrationType: "joint",
          roles: [
            { person: dana, role: "joint_owner" },
            { person: jordan, role: "joint_owner" },
          ],
          positions: [
            position("LKBF", { shares: "300.000000", price: "10.02", marketValue: "3006.00" }),
            position("LKSF", { shares: "30.000000", price: "153.40", marketValue: "4602.00" }),
            position("SWEEP", { shares: "6476.650000", price: "1.00", marketValue: "6476.65" }),
          ],
        },
        {
          publicId: UUID,
          accountNumberEnding: "0002",
          registrationType: "traditional_ira",
          roles: [
            { person: dana, role: "owner" },
            { person: jordan, role: "beneficiary" },
          ],
          positions: [
            position("LKSF", { shares: "20.000000", price: "153.40", marketValue: "3068.00" }),
            position("SWEEP", { shares: "2995.000000", price: "1.00", marketValue: "2995.00" }),
          ],
        },
      ],
    });
    // The full account number stays on the server.
    expect(JSON.stringify(overview)).not.toContain("CW-00000");
  });

  test("before any Delivery, has no As-of date and no Positions", async ({ orm }) => {
    const { larkspur } = await seededFirms(orm);
    const publicId = await reyesPublicId(orm);

    const overview = await getHouseholdOverview(orm, { firmId: larkspur, publicId });

    expect(overview?.asOf).toBeNull();
    expect(
      overview?.accounts.map(({ accountNumberEnding, registrationType, positions }) => ({
        accountNumberEnding,
        registrationType,
        positions,
      })),
    ).toEqual([
      { accountNumberEnding: "0001", registrationType: null, positions: [] },
      { accountNumberEnding: "0002", registrationType: null, positions: [] },
    ]);
  });

  test("a Household with no People has no Accounts", async ({ orm }) => {
    const { globex } = await seededFirms(orm);
    const [row] = await orm
      .insert(household)
      .values({ firmId: globex, name: "Globex Household", relationshipStatus: "prospect" })
      .returning({ publicId: household.publicId });

    expect(await getHouseholdOverview(orm, { firmId: globex, publicId: row!.publicId })).toEqual({
      publicId: row!.publicId,
      name: "Globex Household",
      relationshipStatus: "prospect",
      asOf: null,
      people: [],
      accounts: [],
    });
  });

  // docs/research/household-accounts.md: only an owner or joint owner role puts an Account in a
  // Household. Jordan Reyes named on his mother's IRA, in her own Household, doesn't make it the
  // Reyes Household's, and her Household's overview still shows who is named on it.
  test.for(["beneficiary", "power_of_attorney", "custodian"] as const)(
    "a member who is only %s on another Household's Account doesn't bring it in",
    async (role, { orm }) => {
      const { larkspur } = await seededFirms(orm);
      const reyes = await reyesPublicId(orm);
      const mothers = await householdOfGrace(orm, { firmId: larkspur, jordanRole: role });

      const reyesAccounts = await getHouseholdOverview(orm, { firmId: larkspur, publicId: reyes });
      expect(reyesAccounts?.accounts.map((a) => a.accountNumberEnding)).toEqual(["0001", "0002"]);

      const hers = await getHouseholdOverview(orm, { firmId: larkspur, publicId: mothers });
      expect(hers?.people.map((p) => p.firstName)).toEqual(["Grace"]);
      expect(
        hers?.accounts.map(({ accountNumberEnding, roles }) => ({
          accountNumberEnding,
          roles: roles.map((r) => `${r.person.firstName} ${r.role}`),
        })),
      ).toEqual([{ accountNumberEnding: "0003", roles: ["Grace owner", `Jordan ${role}`] }]);
    },
  );

  // docs/research/household-accounts.md, "Rule for Cognitive Wealth" 1: roles are dated, and the
  // As-of date picks the ones that count.
  test("an Account role that starts after the As-of date doesn't count yet", async ({ orm }) => {
    const { larkspur } = await seededFirms(orm);
    await ingested(orm, { firmId: larkspur, asOfs: ["2026-03-02", "2026-03-06"] });
    const reyes = await reyesPublicId(orm);
    const mothers = await householdOfGrace(orm, {
      firmId: larkspur,
      jordanRole: "beneficiary",
      startsOn: "2026-03-09",
    });

    const hers = await getHouseholdOverview(orm, { firmId: larkspur, publicId: mothers });
    expect(hers?.asOf).toBe("2026-03-06");
    expect(hers?.accounts).toEqual([]);

    // Jordan becomes a joint owner of CW-000003 the Monday after: not on 6 March either.
    await orm.insert(accountRole).values({
      firmId: larkspur,
      personId: (await orm.select().from(person).where(eq(person.firstName, "Jordan")))[0]!.id,
      accountId: (
        await orm
          .select()
          .from(custodialAccount)
          .where(eq(custodialAccount.accountNumber, "CW-000003"))
      )[0]!.id,
      role: "joint_owner",
      startsOn: "2026-03-09",
    });
    const ours = await getHouseholdOverview(orm, { firmId: larkspur, publicId: reyes });
    expect(ours?.accounts.map((a) => a.accountNumberEnding)).toEqual(["0001", "0002"]);
  });

  test("before any Delivery, counts the roles that have started by today", async ({ orm }) => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-03-01T12:00:00Z") });
    // The shared config restores mocks, envs and globals, not timers.
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const { larkspur } = await seededFirms(orm);
    const publicId = await reyesPublicId(orm);

    // Dana's IRA (CW-000002) is hers from 2 March; the joint account from 26 February.
    const overview = await getHouseholdOverview(orm, { firmId: larkspur, publicId });
    expect(overview?.asOf).toBeNull();
    expect(overview?.accounts.map((a) => a.accountNumberEnding)).toEqual(["0001"]);
  });

  test("gives nothing for another Firm's Household", async ({ orm }) => {
    const { larkspur, globex } = await seededFirms(orm);
    await ingested(orm, { firmId: larkspur, asOfs: ["2026-03-06"] });
    const publicId = await reyesPublicId(orm);

    expect(await getHouseholdOverview(orm, { firmId: globex, publicId })).toBeNull();
  });

  test.for([
    // A UUIDv7 no row has.
    "01900000-0000-7000-8000-000000000000",
    // Not a UUID at all, so Postgres would refuse to compare it.
    "not-a-uuid",
  ])("gives nothing for the unknown publicId %s", async (publicId, { orm }) => {
    const { larkspur } = await seededFirms(orm);

    expect(await getHouseholdOverview(orm, { firmId: larkspur, publicId })).toBeNull();
  });
});
