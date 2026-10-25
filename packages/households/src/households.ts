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
import {
  type PublicHousehold,
  toPublicAccountRole,
  toPublicHousehold,
  toPublicPerson,
} from "./dto";

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

  const rolesOf = Map.groupBy(roles, (row) => row.personId);
  const membersOf = Map.groupBy(members, (row) => row.householdId);
  // The Primary first, then the Co-client, then the Dependents.
  const inRoleOrder = (rows: typeof members) =>
    HOUSEHOLD_ROLES.flatMap((role) => rows.filter((row) => row.role === role));
  return households.map((row) =>
    toPublicHousehold(
      row,
      inRoleOrder(membersOf.get(row.id) ?? []).map((member) =>
        toPublicPerson({
          row: member.person,
          householdRole: member.role,
          accountRoles: (rolesOf.get(member.person.id) ?? []).map(({ role, account }) =>
            toPublicAccountRole(role, account),
          ),
        }),
      ),
    ),
  );
}
