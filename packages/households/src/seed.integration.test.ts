import { readFileSync } from "node:fs";
import type { Database } from "@repo/db";
import {
  accountRole,
  custodialAccount,
  household,
  householdMember,
  organization,
  person,
  user,
  worldSeed,
} from "@repo/db/schema";
import { WORLD_FIRM_SLUG } from "@repo/db/seed-data";
import { test } from "@repo/db/testing";
import { asc, eq } from "drizzle-orm";
import { endAccountRole, endHouseholdMembership } from "./end";
import { SeedConflict, seedDevWorld } from "./seed";
import { InvalidWorldError, type World, householdPeople, parseWorld } from "./world";

const readWorld = (path = "v0.json"): unknown =>
  JSON.parse(readFileSync(new URL(`../../../world/${path}`, import.meta.url), "utf8"));

// Every row of every CRM table, and the seed's record of the world it loaded, in a stable order.
// Called with `migratorOrm`, which owns the tables, so row-level security doesn't hide any Firm's.
async function crmRows(db: Database) {
  const [households, people, members, accounts, roles, seeds] = await Promise.all([
    db.select().from(household).orderBy(asc(household.id)),
    db.select().from(person).orderBy(asc(person.id)),
    db.select().from(householdMember).orderBy(asc(householdMember.id)),
    db.select().from(custodialAccount).orderBy(asc(custodialAccount.id)),
    db.select().from(accountRole).orderBy(asc(accountRole.id)),
    db.select().from(worldSeed).orderBy(asc(worldSeed.id)),
  ]);
  return { households, people, members, accounts, roles, seeds };
}

// What an Advisor might do to the Reyes Household in the app: rename it and add a Dependent.
// Written as `migratorOrm`, like `crmRows`.
async function editInTheApp(db: Database) {
  const [reyes] = await db
    .update(household)
    .set({ name: "Reyes Family" })
    .where(eq(household.seedKey, "reyes"))
    .returning();
  const [child] = await db
    .insert(person)
    .values({ firmId: reyes!.firmId, firstName: "Sam", lastName: "Reyes", bornOn: "2015-06-01" })
    .returning();
  await db.insert(householdMember).values({
    firmId: reyes!.firmId,
    householdId: reyes!.id,
    personId: child!.id,
    role: "dependent",
    startsOn: "2026-03-02",
  });
}

/** Ends a seeded Account role of Jordan's and their membership, as `app`, as the app would. */
async function endInTheApp(orm: Database, migratorOrm: Database) {
  const firmId = await larkspurId(orm);
  const [home] = await migratorOrm.select().from(household);
  const [jordan] = await migratorOrm.select().from(person).where(eq(person.firstName, "Jordan"));
  const [role] = await migratorOrm
    .select()
    .from(accountRole)
    .where(eq(accountRole.personId, jordan!.id));
  const actor = { system: "test" };
  await endAccountRole(orm, { firmId, actor, publicId: role!.publicId, endsOn: "2026-04-01" });
  await endHouseholdMembership(orm, {
    firmId,
    actor,
    householdPublicId: home!.publicId,
    personPublicId: jordan!.publicId,
    endsOn: "2026-04-01",
  });
}

const okafor: World["crm"]["households"][number] = {
  key: "okafor",
  name: "The Okafor Household",
  relationship_status: "prospect",
  primary: {
    key: "ada-okafor",
    first_name: "Ada",
    last_name: "Okafor",
    born_on: "1985-11-30",
    joined_on: "2026-03-02",
    account_roles: [],
  },
  co_client: null,
  dependents: [],
};

async function larkspurId(db: Database) {
  const [firm] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, WORLD_FIRM_SLUG));
  return firm!.id;
}

describe("seedDevWorld", () => {
  test("loads the generated world, which has no Accounts yet", async ({ orm, migratorOrm }) => {
    const world = parseWorld(readWorld("generated.json"));
    const members = world.crm.households.flatMap((home) => [...householdPeople(home)]);

    expect((await seedDevWorld(orm, world)).crm).toEqual({
      added: {
        households: 60,
        people: members.length,
        householdMembers: members.length,
        accounts: 0,
        accountRoles: 0,
      },
    });

    const { households, people, roles } = await crmRows(migratorOrm);
    expect(households).toHaveLength(60);
    expect(people).toHaveLength(members.length);
    expect(roles).toEqual([]);
    const statuses = new Set(households.map((row) => row.relationshipStatus));
    expect(statuses).toEqual(new Set(["prospect", "client", "former_client"]));
  });

  test("loads world v0's CRM half into Larkspur", async ({ orm, migratorOrm }) => {
    expect((await seedDevWorld(orm, readWorld())).crm).toEqual({
      added: { households: 1, people: 2, householdMembers: 2, accounts: 2, accountRoles: 4 },
    });

    const { households, people, members, accounts, roles } = await crmRows(migratorOrm);
    expect(households).toMatchObject([
      { seedKey: "reyes", name: "The Reyes Household", relationshipStatus: "client" },
    ]);
    expect(people).toMatchObject([
      { seedKey: "dana-reyes", firstName: "Dana", lastName: "Reyes", bornOn: "1978-05-14" },
      { seedKey: "jordan-reyes", firstName: "Jordan", lastName: "Reyes", bornOn: "1980-09-02" },
    ]);
    expect(members.map(({ personId, role }) => ({ personId, role }))).toEqual([
      { personId: people[0]!.id, role: "primary" },
      { personId: people[1]!.id, role: "co_client" },
    ]);
    // The Custodian fills in the rest when its feed is ingested (ADR 0009).
    expect(accounts).toMatchObject([
      { accountNumber: "CW-000001", registrationType: null },
      { accountNumber: "CW-000002", registrationType: null },
    ]);
    const numberOf = new Map(accounts.map((a) => [a.id, a.accountNumber]));
    const keyOf = new Map(people.map((p) => [p.id, p.seedKey]));
    expect(
      roles.map((r) => [keyOf.get(r.personId), numberOf.get(r.accountId), r.role, r.startsOn]),
    ).toEqual([
      ["dana-reyes", "CW-000001", "joint_owner", "2026-02-26"],
      ["dana-reyes", "CW-000002", "owner", "2026-03-02"],
      ["jordan-reyes", "CW-000001", "joint_owner", "2026-02-26"],
      ["jordan-reyes", "CW-000002", "beneficiary", "2026-03-02"],
    ]);
  });

  test("gives the same rows when run twice", async ({ orm, migratorOrm }) => {
    await seedDevWorld(orm, readWorld());
    const first = await crmRows(migratorOrm);

    expect((await seedDevWorld(orm, readWorld())).crm).toEqual({
      added: { households: 0, people: 0, householdMembers: 0, accounts: 0, accountRoles: 0 },
    });
    expect(await crmRows(migratorOrm)).toEqual(first);
  });

  test("puts every row in Larkspur", async ({ orm, migratorOrm }) => {
    await seedDevWorld(orm, readWorld());
    const firmId = await larkspurId(orm);

    const rows = Object.values(await crmRows(migratorOrm)).flat();
    expect(rows).toHaveLength(12);
    expect(new Set(rows.map((row) => row.firmId))).toEqual(new Set([firmId]));
  });

  // One file the schema catches and one only the cross-field rules do (world/invalid/cases.json).
  test.for(["unknown-field.json", "role-names-unknown-account.json"])(
    "writes nothing when the world file is invalid (%s)",
    async (file, { orm, migratorOrm }) => {
      await expect(seedDevWorld(orm, readWorld(`invalid/${file}`))).rejects.toThrow(
        InvalidWorldError,
      );

      expect(await orm.$count(user)).toBe(0);
      expect(await orm.$count(organization)).toBe(0);
      expect(Object.values(await crmRows(migratorOrm)).flat()).toEqual([]);
    },
  );

  test("writes nothing when the world's Firm isn't Larkspur", async ({ orm, migratorOrm }) => {
    const world = parseWorld(readWorld());
    world.crm.firm.name = "Larkspur Partners";

    await expect(seedDevWorld(orm, world)).rejects.toThrow(
      `crm.firm.name: 'Larkspur Partners' isn't the seeded Firm 'Larkspur Wealth Partners'`,
    );
    expect(await orm.$count(user)).toBe(0);
    expect(await orm.$count(organization)).toBe(0);
    expect(Object.values(await crmRows(migratorOrm)).flat()).toEqual([]);
  });

  // Like the custodian's `world:load` (`LoadConflict`): a rerun adds what's missing, but never
  // silently keeps rows the world file now describes differently.
  test.for<[string, (world: World) => void, string]>([
    [
      "a Household's name",
      (world) => {
        world.crm.households[0]!.name = "The Reyes Family";
      },
      "Household reyes is already seeded with other details",
    ],
    [
      "a Person's birth date",
      (world) => {
        world.crm.households[0]!.primary.born_on = "1978-05-15";
      },
      "Person dana-reyes is already seeded with other details",
    ],
    [
      "who is Primary",
      (world) => {
        const home = world.crm.households[0]!;
        [home.primary, home.co_client] = [home.co_client!, home.primary];
      },
      "Household reyes already has other People in other roles",
    ],
    [
      "when a Person joined",
      (world) => {
        world.crm.households[0]!.co_client!.joined_on = "2026-02-27";
      },
      "Household reyes already has other People in other roles",
    ],
    [
      "an Account role",
      (world) => {
        world.crm.households[0]!.co_client!.account_roles[1]!.role = "owner";
      },
      "Person jordan-reyes already holds other Account roles",
    ],
  ])(
    "refuses a world that changes %s, and writes nothing",
    async ([, change, message], { orm, migratorOrm }) => {
      await seedDevWorld(orm, readWorld());
      const seeded = await crmRows(migratorOrm);
      const world = parseWorld(readWorld());
      change(world);

      await expect(seedDevWorld(orm, world)).rejects.toThrow(new SeedConflict(message));
      expect(await crmRows(migratorOrm)).toEqual(seeded);
    },
  );

  test("adds a Household the world file gained since the last run", async ({ orm }) => {
    await seedDevWorld(orm, readWorld());
    const world = parseWorld(readWorld());
    world.crm.households.push(okafor);

    expect((await seedDevWorld(orm, world)).crm).toEqual({
      added: { households: 1, people: 1, householdMembers: 1, accounts: 0, accountRoles: 0 },
    });
  });

  // The fingerprint: the database records which CRM half the Firm was seeded from, so a rerun can
  // tell the world file changing from someone editing the rows in the app.
  test("leaves app edits alone when the world file hasn't changed", async ({
    orm,
    migratorOrm,
  }) => {
    await seedDevWorld(orm, readWorld());
    await editInTheApp(migratorOrm);
    const edited = await crmRows(migratorOrm);

    expect((await seedDevWorld(orm, readWorld())).crm).toEqual({
      added: { households: 0, people: 0, householdMembers: 0, accounts: 0, accountRoles: 0 },
    });
    expect(await crmRows(migratorOrm)).toEqual(edited);
    expect(edited.households.map((h) => h.name)).toEqual(["Reyes Family"]);
  });

  test("refuses when the world file changed and its rows were edited in the app", async ({
    orm,
    migratorOrm,
  }) => {
    await seedDevWorld(orm, readWorld());
    await editInTheApp(migratorOrm);
    const edited = await crmRows(migratorOrm);
    const world = parseWorld(readWorld());
    world.crm.households.push(okafor);

    await expect(seedDevWorld(orm, world)).rejects.toThrow(
      new SeedConflict("Household reyes is already seeded with other details"),
    );
    expect(await crmRows(migratorOrm)).toEqual(edited);
  });

  test("leaves a role and membership the app ended when the world file hasn't changed", async ({
    orm,
    migratorOrm,
  }) => {
    await seedDevWorld(orm, readWorld());
    await endInTheApp(orm, migratorOrm);
    const ended = await crmRows(migratorOrm);

    await seedDevWorld(orm, readWorld());

    expect(await crmRows(migratorOrm)).toEqual(ended);
  });

  // Uniqueness covers only current memberships, so conflict-skipping alone would seat Jordan again.
  test("refuses a changed world file rather than undo an end, and inserts nothing", async ({
    orm,
    migratorOrm,
  }) => {
    await seedDevWorld(orm, readWorld());
    await endInTheApp(orm, migratorOrm);
    const ended = await crmRows(migratorOrm);
    const world = parseWorld(readWorld());
    world.crm.households.push(okafor);

    await expect(seedDevWorld(orm, world)).rejects.toThrow(SeedConflict);

    expect(await crmRows(migratorOrm)).toEqual(ended);
  });

  test("remembers the new world once it loads", async ({ orm, migratorOrm }) => {
    await seedDevWorld(orm, readWorld());
    const world = parseWorld(readWorld());
    world.crm.households.push(okafor);
    await seedDevWorld(orm, world);
    await editInTheApp(migratorOrm);

    expect((await seedDevWorld(orm, world)).crm.added.households).toBe(0);
  });
});
