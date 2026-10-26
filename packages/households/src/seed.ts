import { createHash } from "node:crypto";
import type { Database } from "@repo/db";
import { withFirm } from "@repo/db/firm";
import {
  accountRole,
  custodialAccount,
  household,
  householdMember,
  organization,
  person,
  worldSeed,
} from "@repo/db/schema";
import { type SeedResult, WORLD_FIRM_SLUG, seedDevData } from "@repo/db/seed-data";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { HouseholdRole } from "@repo/db/schema/households";
import {
  InvalidWorldError,
  type World,
  type WorldPerson,
  householdPeople,
  parseWorld,
} from "./world";

/** The database already holds a seeded row the world file now describes differently. */
export class SeedConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedConflict";
  }
}

export interface CrmSeedResult {
  /** Rows this run inserted; rows that already existed are left as they are. */
  added: {
    households: number;
    people: number;
    householdMembers: number;
    accounts: number;
    accountRoles: number;
  };
}

/**
 * `cw db seed`: the dev users and Firms (`seedDevData`), then the world file's CRM half loaded
 * into the world's Firm, all in one transaction. The world file is checked first, and a world
 * whose Firm isn't the seeded one is refused, so either way nothing is written.
 *
 * The Firm's `world_seed` row remembers which CRM half it was last seeded from. The same file
 * again skips the CRM half, so edits made in the app since are kept. A changed file adds what's
 * new and refuses (`SeedConflict`) when a row it seeded before now differs, whether the file or
 * the app changed it.
 */
export async function seedDevWorld(
  db: Database,
  worldJson: unknown,
): Promise<{ devData: SeedResult; crm: CrmSeedResult }> {
  const world = parseWorld(worldJson);
  return db.transaction(async (tx) => {
    const devData = await seedDevData(tx);
    const [firm] = await tx
      .select({ id: organization.id, name: organization.name })
      .from(organization)
      .where(eq(organization.slug, WORLD_FIRM_SLUG));
    if (!firm) throw new Error(`The seed made no Firm with the slug '${WORLD_FIRM_SLUG}'.`);
    if (firm.name !== world.crm.firm.name) {
      throw new InvalidWorldError(
        "crm.firm.name",
        `'${world.crm.firm.name}' isn't the seeded Firm '${firm.name}'`,
      );
    }
    // The CRM half is the Firm's own rows, written under its row-level security (ADR 0020).
    const crm = await withFirm(tx, {
      firmId: firm.id,
      query: (firmTx) => seedCrmHalf(firmTx, { firmId: firm.id, world }),
    });
    return { devData, crm };
  });
}

/** The world's CRM half into the Firm `firmId`, unless its `world_seed` says it's there already. */
async function seedCrmHalf(
  db: Database,
  { firmId, world }: { firmId: number; world: World },
): Promise<CrmSeedResult> {
  // Seeded from this very file already: whatever differs now was edited in the app, and stays.
  const worldHash = createHash("sha256").update(JSON.stringify(world.crm)).digest("hex");
  const [last] = await db
    .select({ worldHash: worldSeed.worldHash })
    .from(worldSeed)
    .where(eq(worldSeed.firmId, firmId));
  if (last?.worldHash === worldHash) return { added: NOTHING_ADDED };

  const crm = await loadCrmHalf(db, { firmId, world });
  await db
    .insert(worldSeed)
    .values({ firmId, worldHash })
    .onConflictDoUpdate({ target: worldSeed.firmId, set: { worldHash, seededAt: new Date() } });
  return crm;
}

const NOTHING_ADDED: CrmSeedResult["added"] = {
  households: 0,
  people: 0,
  householdMembers: 0,
  accounts: 0,
  accountRoles: 0,
};

/**
 * Adds the CRM half's Households, People, Account roles and the Accounts they name to the Firm
 * `firmId`. Idempotent: Households and People are found again by their world file key, Accounts
 * by number, and rows that already exist are left as they are. Accounts get only their number:
 * the rest comes from the Custodian (ADR 0009), so the custodian half is never copied.
 */
async function loadCrmHalf(
  db: Database,
  { firmId, world }: { firmId: number; world: World },
): Promise<CrmSeedResult> {
  const { households } = world.crm;
  if (households.length === 0) return { added: NOTHING_ADDED };
  // Every Household has a Primary, so from here on there are People too.
  const people = households.flatMap((home) =>
    [...householdPeople(home)].map(([, worldPerson, role]) => ({
      householdKey: home.key,
      worldPerson,
      role,
    })),
  );
  const accountNumbers = [
    ...new Set(
      people.flatMap(({ worldPerson }) => worldPerson.account_roles.map((r) => r.account_number)),
    ),
  ];

  const addedHouseholds = await db
    .insert(household)
    .values(
      households.map((home) => ({
        firmId,
        seedKey: home.key,
        name: home.name,
        relationshipStatus: home.relationship_status,
      })),
    )
    .onConflictDoNothing({ target: [household.firmId, household.seedKey] })
    .returning({ id: household.id });
  const addedPeople = await db
    .insert(person)
    .values(
      people.map(({ worldPerson }) => ({
        firmId,
        seedKey: worldPerson.key,
        firstName: worldPerson.first_name,
        lastName: worldPerson.last_name,
        bornOn: worldPerson.born_on,
      })),
    )
    .onConflictDoNothing({ target: [person.firmId, person.seedKey] })
    .returning({ id: person.id });
  const addedAccounts = accountNumbers.length
    ? await db
        .insert(custodialAccount)
        .values(accountNumbers.map((accountNumber) => ({ firmId, accountNumber })))
        .onConflictDoNothing({ target: [custodialAccount.firmId, custodialAccount.accountNumber] })
        .returning({ id: custodialAccount.id })
    : [];

  const householdIds = await idsByKey(db, {
    table: household,
    key: household.seedKey,
    firmId,
    keys: households.map((home) => home.key),
  });
  const personIds = await idsByKey(db, {
    table: person,
    key: person.seedKey,
    firmId,
    keys: people.map(({ worldPerson }) => worldPerson.key),
  });
  const accountIds = await idsByKey(db, {
    table: custodialAccount,
    key: custodialAccount.accountNumber,
    firmId,
    keys: accountNumbers,
  });

  // No conflict target: a Household that already has a Primary or Co-client keeps them.
  const addedMembers = await db
    .insert(householdMember)
    .values(
      people.map(({ householdKey, worldPerson, role }) => ({
        firmId,
        householdId: householdIds.get(householdKey)!,
        personId: personIds.get(worldPerson.key)!,
        role,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: householdMember.id });
  const roles = people.flatMap(({ worldPerson }) =>
    worldPerson.account_roles.map((r) => ({
      firmId,
      personId: personIds.get(worldPerson.key)!,
      accountId: accountIds.get(r.account_number)!,
      role: r.role,
      startsOn: r.starts_on,
    })),
  );
  const addedRoles = roles.length
    ? await db
        .insert(accountRole)
        .values(roles)
        .onConflictDoNothing({
          target: [
            accountRole.personId,
            accountRole.accountId,
            accountRole.role,
            accountRole.startsOn,
          ],
        })
        .returning({ id: accountRole.id })
    : [];

  await refuseChangedRows(db, {
    firmId,
    world,
    people,
    householdIds: [...householdIds.values()],
    personIds: [...personIds.values()],
  });

  return {
    added: {
      households: addedHouseholds.length,
      people: addedPeople.length,
      householdMembers: addedMembers.length,
      accounts: addedAccounts.length,
      accountRoles: addedRoles.length,
    },
  };
}

type RefuseChangedRowsArgs = {
  firmId: number;
  world: World;
  people: { householdKey: string; worldPerson: WorldPerson; role: HouseholdRole }[];
  householdIds: number[];
  personIds: number[];
};

/**
 * Throws a `SeedConflict` unless every seeded row the world file describes matches it: each
 * Household's and Person's details, who is in each Household in which role, and each Person's
 * Account roles. Called after the inserts, so a new row matches trivially and an old one that
 * differs is caught; the caller's transaction then rolls the whole run back. Rows the world file
 * doesn't name, such as a Household it no longer has, are left alone.
 */
async function refuseChangedRows(
  db: Database,
  { firmId, world, people, householdIds, personIds }: RefuseChangedRowsArgs,
) {
  const [households, persons, members, roles] = await Promise.all([
    db
      .select({
        key: household.seedKey,
        name: household.name,
        relationshipStatus: household.relationshipStatus,
      })
      .from(household)
      .where(and(eq(household.firmId, firmId), inArray(household.id, householdIds))),
    db
      .select({
        key: person.seedKey,
        firstName: person.firstName,
        lastName: person.lastName,
        bornOn: person.bornOn,
      })
      .from(person)
      .where(and(eq(person.firmId, firmId), inArray(person.id, personIds))),
    db
      .select({
        householdKey: household.seedKey,
        personKey: person.seedKey,
        role: householdMember.role,
      })
      .from(householdMember)
      .innerJoin(household, eq(household.id, householdMember.householdId))
      .innerJoin(person, eq(person.id, householdMember.personId))
      .where(
        and(eq(householdMember.firmId, firmId), inArray(householdMember.householdId, householdIds)),
      ),
    db
      .select({
        personKey: person.seedKey,
        accountNumber: custodialAccount.accountNumber,
        role: accountRole.role,
        startsOn: accountRole.startsOn,
      })
      .from(accountRole)
      .innerJoin(person, eq(person.id, accountRole.personId))
      .innerJoin(custodialAccount, eq(custodialAccount.id, accountRole.accountId))
      .where(and(eq(accountRole.firmId, firmId), inArray(accountRole.personId, personIds))),
  ]);

  const loadedHouseholds = new Map(households.map((row) => [row.key, row]));
  for (const home of world.crm.households) {
    const loaded = loadedHouseholds.get(home.key);
    if (loaded?.name !== home.name || loaded.relationshipStatus !== home.relationship_status) {
      throw new SeedConflict(`Household ${home.key} is already seeded with other details`);
    }
  }
  const loadedPeople = new Map(persons.map((row) => [row.key, row]));
  for (const { worldPerson: wanted } of people) {
    const loaded = loadedPeople.get(wanted.key);
    if (
      loaded?.firstName !== wanted.first_name ||
      loaded.lastName !== wanted.last_name ||
      loaded.bornOn !== wanted.born_on
    ) {
      throw new SeedConflict(`Person ${wanted.key} is already seeded with other details`);
    }
  }
  for (const home of world.crm.households) {
    const wanted = people
      .filter((p) => p.householdKey === home.key)
      .map((p) => `${p.worldPerson.key} ${p.role}`);
    const loaded = members
      .filter((m) => m.householdKey === home.key)
      .map((m) => `${m.personKey} ${m.role}`);
    if (!sameItems(wanted, loaded)) {
      throw new SeedConflict(`Household ${home.key} already has other People in other roles`);
    }
  }
  for (const { worldPerson } of people) {
    const wanted = worldPerson.account_roles.map(
      (r) => `${r.account_number} ${r.role} ${r.starts_on}`,
    );
    const loaded = roles
      .filter((r) => r.personKey === worldPerson.key)
      .map((r) => `${r.accountNumber} ${r.role} ${r.startsOn}`);
    if (!sameItems(wanted, loaded)) {
      throw new SeedConflict(`Person ${worldPerson.key} already holds other Account roles`);
    }
  }
}

// The same items in any order. Sets, since a row the world file lists twice is still one row.
function sameItems(a: string[], b: string[]) {
  return new Set(a).symmetricDifference(new Set(b)).size === 0;
}

type IdsByKeyArgs = {
  table: typeof household | typeof person | typeof custodialAccount;
  key: AnyPgColumn;
  firmId: number;
  keys: string[];
};

/** The ids of the Firm's rows whose `key` column holds one of `keys`, by that key. */
async function idsByKey(
  db: Database,
  { table, key, firmId, keys }: IdsByKeyArgs,
): Promise<Map<string, number>> {
  const rows = await db
    .select({ id: table.id, key: sql<string>`${key}` })
    .from(table)
    .where(and(eq(table.firmId, firmId), inArray(key, keys)));
  return new Map(rows.map((row) => [row.key, row.id]));
}
