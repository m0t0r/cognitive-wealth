import type { Database } from "@repo/db";
import { withFirm } from "@repo/db/firm";
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
import { membershipHolds, roleHolds, today } from "./holds";

/**
 * The Firm `firmId`'s Households, by name, with the People in them today and the Account roles each
 * holds today. The Firm is passed in, never read from a session. The queries run inside `withFirm`,
 * so row-level security holds them to the Firm, and each still filters by it too (ADR 0020).
 */
export async function listHouseholds(db: Database, firmId: number): Promise<PublicHousehold[]> {
  return withFirm(db, { firmId, query: (tx) => householdsOf(tx, firmId) });
}

async function householdsOf(db: Database, firmId: number): Promise<PublicHousehold[]> {
  const on = today();
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
      .where(and(eq(householdMember.firmId, firmId), membershipHolds(on)))
      .orderBy(asc(person.id)),
    db
      .select({ personId: accountRole.personId, role: accountRole, account: custodialAccount })
      .from(accountRole)
      .innerJoin(
        custodialAccount,
        and(eq(custodialAccount.id, accountRole.accountId), eq(custodialAccount.firmId, firmId)),
      )
      .where(and(eq(accountRole.firmId, firmId), roleHolds(on)))
      .orderBy(asc(custodialAccount.accountNumber), asc(accountRole.startsOn), asc(accountRole.id)),
  ]);

  const rolesOf = Map.groupBy(roles, (row) => row.personId);
  const membersOf = Map.groupBy(members, (row) => row.householdId);
  // The Primary first, then the Co-client, then the Dependents.
  const inRoleOrder = (rows: typeof members) =>
    HOUSEHOLD_ROLES.flatMap((role) => rows.filter((row) => row.role === role));
  return households.map((row) =>
    toPublicHousehold({
      row,
      people: inRoleOrder(membersOf.get(row.id) ?? []).map((member) =>
        toPublicPerson({
          row: member.person,
          householdRole: member.role,
          accountRoles: (rolesOf.get(member.person.id) ?? []).map(({ role, account }) =>
            toPublicAccountRole({ row: role, account }),
          ),
        }),
      ),
    }),
  );
}
