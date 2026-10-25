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
} from "@repo/db/schema";
import { WORLD_FIRM_SLUG } from "@repo/db/seed-data";
import { test } from "@repo/db/testing";
import { asc, eq } from "drizzle-orm";
import { seedDevWorld } from "./seed";
import { InvalidWorldError, parseWorld } from "./world";

const readWorld = (path = "v0.json"): unknown =>
  JSON.parse(readFileSync(new URL(`../../../world/${path}`, import.meta.url), "utf8"));

// Every row of every CRM table, in a stable order.
async function crmRows(db: Database) {
  const [households, people, members, accounts, roles] = await Promise.all([
    db.select().from(household).orderBy(asc(household.id)),
    db.select().from(person).orderBy(asc(person.id)),
    db.select().from(householdMember).orderBy(asc(householdMember.id)),
    db.select().from(custodialAccount).orderBy(asc(custodialAccount.id)),
    db.select().from(accountRole).orderBy(asc(accountRole.id)),
  ]);
  return { households, people, members, accounts, roles };
}

async function larkspurId(db: Database) {
  const [firm] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, WORLD_FIRM_SLUG));
  return firm!.id;
}

describe("seedDevWorld", () => {
  test("loads world v0's CRM half into Larkspur", async ({ orm }) => {
    expect((await seedDevWorld(orm, readWorld())).crm).toEqual({
      added: { households: 1, people: 2, householdMembers: 2, accounts: 2, accountRoles: 4 },
    });

    const { households, people, members, accounts, roles } = await crmRows(orm);
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

  test("gives the same rows when run twice", async ({ orm }) => {
    await seedDevWorld(orm, readWorld());
    const first = await crmRows(orm);

    expect((await seedDevWorld(orm, readWorld())).crm).toEqual({
      added: { households: 0, people: 0, householdMembers: 0, accounts: 0, accountRoles: 0 },
    });
    expect(await crmRows(orm)).toEqual(first);
  });

  test("puts every row in Larkspur", async ({ orm }) => {
    await seedDevWorld(orm, readWorld());
    const firmId = await larkspurId(orm);

    const rows = Object.values(await crmRows(orm)).flat();
    expect(rows).toHaveLength(11);
    expect(new Set(rows.map((row) => row.firmId))).toEqual(new Set([firmId]));
  });

  // One file the schema catches and one only the cross-field rules do (world/invalid/cases.json).
  test.for(["unknown-field.json", "role-names-unknown-account.json"])(
    "writes nothing when the world file is invalid (%s)",
    async (file, { orm }) => {
      await expect(seedDevWorld(orm, readWorld(`invalid/${file}`))).rejects.toThrow(
        InvalidWorldError,
      );

      expect(await orm.$count(user)).toBe(0);
      expect(await orm.$count(organization)).toBe(0);
      expect(Object.values(await crmRows(orm)).flat()).toEqual([]);
    },
  );

  test("writes nothing when the world's Firm isn't Larkspur", async ({ orm }) => {
    const world = parseWorld(readWorld());
    world.crm.firm.name = "Larkspur Partners";

    await expect(seedDevWorld(orm, world)).rejects.toThrow(
      `crm.firm.name: 'Larkspur Partners' isn't the seeded Firm 'Larkspur Wealth Partners'`,
    );
    expect(await orm.$count(user)).toBe(0);
    expect(await orm.$count(organization)).toBe(0);
    expect(Object.values(await crmRows(orm)).flat()).toEqual([]);
  });
});
