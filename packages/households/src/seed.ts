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
import { and, eq, inArray } from "drizzle-orm";
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
    if (firm!.name !== world.crm.firm.name) {
      throw new InvalidWorldError(
        "crm.firm.name",
        `'${world.crm.firm.name}' isn't the seeded Firm '${firm!.name}'`,
      );
    }
    return { devData, crm: await loadCrmHalf(tx, firm!.id, world) };
  });
}

/**
 * Adds the CRM half's Households, People, Account roles and the Accounts they name to the Firm
 * `firmId`. Idempotent: Households and People are found again by their world file key, Accounts
 * by number, and rows that already exist are left as they are. Accounts get only their number:
 * the rest comes from the Custodian (ADR 0009), so the custodian half is never copied.
 */
export async function loadCrmHalf(
  db: Database,
  firmId: number,
  world: World,
): Promise<CrmSeedResult> {
  const { households } = world.crm;
  if (households.length === 0) {
    return {
      added: { households: 0, people: 0, householdMembers: 0, accounts: 0, accountRoles: 0 },
    };
  }
  // Every Household has a Primary, so from here on there are People too.
  const people = households.flatMap((h) =>
    [...householdPeople(h)].map(([, p, role]) => ({ h, p, role })),
  );
  const accountNumbers = [
    ...new Set(people.flatMap(({ p }) => p.account_roles.map((r) => r.account_number))),
  ];

  const addedHouseholds = await db
    .insert(household)
    .values(
      households.map((h) => ({
        firmId,
        seedKey: h.key,
        name: h.name,
        relationshipStatus: h.relationship_status,
      })),
    )
    .onConflictDoNothing({ target: [household.firmId, household.seedKey] })
    .returning({ id: household.id });
  const addedPeople = await db
    .insert(person)
    .values(
      people.map(({ p }) => ({
        firmId,
        seedKey: p.key,
        firstName: p.first_name,
        lastName: p.last_name,
        bornOn: p.born_on,
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

  const householdIds = new Map(
    (
      await db
        .select({ id: household.id, key: household.seedKey })
        .from(household)
        .where(
          and(
            eq(household.firmId, firmId),
            inArray(
              household.seedKey,
              households.map((h) => h.key),
            ),
          ),
        )
    ).map((row) => [row.key, row.id]),
  );
  const personIds = new Map(
    (
      await db
        .select({ id: person.id, key: person.seedKey })
        .from(person)
        .where(
          and(
            eq(person.firmId, firmId),
            inArray(
              person.seedKey,
              people.map(({ p }) => p.key),
            ),
          ),
        )
    ).map((row) => [row.key, row.id]),
  );
  const accountIds = new Map(
    (
      await db
        .select({ id: custodialAccount.id, number: custodialAccount.accountNumber })
        .from(custodialAccount)
        .where(
          and(
            eq(custodialAccount.firmId, firmId),
            inArray(custodialAccount.accountNumber, accountNumbers),
          ),
        )
    ).map((row) => [row.number, row.id]),
  );

  // No conflict target: a Household that already has a Primary or Co-client keeps them.
  const addedMembers = await db
    .insert(householdMember)
    .values(
      people.map(({ h, p, role }) => ({
        firmId,
        householdId: householdIds.get(h.key)!,
        personId: personIds.get(p.key)!,
        role,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: householdMember.id });
  const roles = people.flatMap(({ p }) =>
    p.account_roles.map((r) => ({
      firmId,
      personId: personIds.get(p.key)!,
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
