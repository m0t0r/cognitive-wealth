import type { Database } from "@repo/db";
import {
  accountRole,
  custodialAccount,
  household,
  householdMember,
  organization,
  person,
} from "@repo/db/schema";
import { type SeedResult, WORLD_FIRM_SLUG, seedDevData } from "@repo/db/seed-data";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { InvalidWorldError, type World, householdPeople, parseWorld } from "./world";

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
 * `pnpm db:seed`: the dev users and Firms (`seedDevData`), then the world file's CRM half loaded
 * into the world's Firm, all in one transaction. The world file is checked first, and a world
 * whose Firm isn't the seeded one is refused, so either way nothing is written.
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
    return { devData, crm: await loadCrmHalf(tx, firm.id, world) };
  });
}

/**
 * Adds the CRM half's Households, People, Account roles and the Accounts they name to the Firm
 * `firmId`. Idempotent: Households and People are found again by their world file key, Accounts
 * by number, and rows that already exist are left as they are. Accounts get only their number:
 * the rest comes from the Custodian (ADR 0009), so the custodian half is never copied.
 */
async function loadCrmHalf(db: Database, firmId: number, world: World): Promise<CrmSeedResult> {
  const { households } = world.crm;
  if (households.length === 0) {
    return {
      added: { households: 0, people: 0, householdMembers: 0, accounts: 0, accountRoles: 0 },
    };
  }
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

  const householdIds = await idsByKey(
    db,
    household,
    household.seedKey,
    firmId,
    households.map((home) => home.key),
  );
  const personIds = await idsByKey(
    db,
    person,
    person.seedKey,
    firmId,
    people.map(({ worldPerson }) => worldPerson.key),
  );
  const accountIds = await idsByKey(
    db,
    custodialAccount,
    custodialAccount.accountNumber,
    firmId,
    accountNumbers,
  );

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

/** The ids of the Firm's rows whose `key` column holds one of `keys`, by that key. */
async function idsByKey(
  db: Database,
  table: typeof household | typeof person | typeof custodialAccount,
  key: AnyPgColumn,
  firmId: number,
  keys: string[],
): Promise<Map<string, number>> {
  const rows = await db
    .select({ id: table.id, key: sql<string>`${key}` })
    .from(table)
    .where(and(eq(table.firmId, firmId), inArray(key, keys)));
  return new Map(rows.map((row) => [row.key, row.id]));
}
