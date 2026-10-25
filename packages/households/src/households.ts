import type { Database } from "@repo/db";
import {
  HOUSEHOLD_ROLES,
  accountRole,
  custodialAccount,
  household,
  householdMember,
  person,
} from "@repo/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { type PublicAccountRole, type PublicHousehold, toPublicAccount } from "./dto";

/**
 * The Firm `firmId`'s Households, by name, with their People and the Account roles each holds.
 * The Firm is passed in, never read from a session: every query filters by it, since nothing
 * else stops one Firm reading another's rows until row-level security (#42).
 */
export async function listHouseholds(db: Database, firmId: number): Promise<PublicHousehold[]> {
  const [households, members, roles] = await Promise.all([
    db
      .select()
      .from(household)
      .where(eq(household.firmId, firmId))
      .orderBy(asc(household.name), asc(household.id)),
    db
      .select({ householdId: householdMember.householdId, role: householdMember.role, person })
      .from(householdMember)
      .innerJoin(person, and(eq(person.id, householdMember.personId), eq(person.firmId, firmId)))
      .where(eq(householdMember.firmId, firmId))
      .orderBy(asc(person.id)),
    db
      .select({ personId: accountRole.personId, role: accountRole, account: custodialAccount })
      .from(accountRole)
      .innerJoin(
        custodialAccount,
        and(eq(custodialAccount.id, accountRole.accountId), eq(custodialAccount.firmId, firmId)),
      )
      .where(eq(accountRole.firmId, firmId))
      .orderBy(asc(custodialAccount.accountNumber), asc(accountRole.startsOn), asc(accountRole.id)),
  ]);

  const rolesOf = groupBy(roles, (row) => row.personId);
  const membersOf = groupBy(members, (row) => row.householdId);
  // The Primary first, then the Co-client, then the Dependents.
  const inRoleOrder = (rows: typeof members) =>
    HOUSEHOLD_ROLES.flatMap((role) => rows.filter((row) => row.role === role));
  return households.map((h) => ({
    publicId: h.publicId,
    name: h.name,
    relationshipStatus: h.relationshipStatus,
    people: inRoleOrder(membersOf.get(h.id) ?? []).map(({ role, person: p }) => ({
      publicId: p.publicId,
      firstName: p.firstName,
      lastName: p.lastName,
      bornOn: p.bornOn,
      householdRole: role,
      accountRoles: (rolesOf.get(p.id) ?? []).map(({ role: r, account }): PublicAccountRole => ({
        account: toPublicAccount(account),
        role: r.role,
        startsOn: r.startsOn,
      })),
    })),
  }));
}

// `Map.groupBy`, which the ES2022 lib the packages target doesn't have.
function groupBy<T, K>(items: readonly T[], keyOf: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}
