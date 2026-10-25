import type { Database } from "@repo/db";
import {
  type AccountRoleKind,
  HOUSEHOLD_ROLES,
  accountRole,
  custodialAccount,
  custodialPosition,
  custodianDelivery,
  household,
  householdMember,
  person,
  security,
} from "@repo/db/schema";
import { and, asc, eq, inArray, lte, max, sql } from "drizzle-orm";
import { z } from "zod";
import {
  type HouseholdOverview,
  toOverviewAccount,
  toOverviewPerson,
  toOverviewPersonName,
  toPublicPosition,
} from "./dto";

const PublicId = z.uuid();

/**
 * The roles that make an Account the Household's: a member owns it, alone or jointly. Being its
 * Beneficiary, its custodian for a minor or holding power of attorney over it gives no ownership,
 * so those Accounts stay with their owner's Household (docs/research/household-accounts.md).
 */
const HOUSEHOLD_ACCOUNT_ROLES = ["owner", "joint_owner"] as const satisfies AccountRoleKind[];

/**
 * The Household `publicId` of the Firm `firmId`, with its People, the Accounts they own (each
 * once, with every Account role on it), and each Account's Positions on the Firm's latest As-of
 * date, or null when the Firm has no such Household. Like `listHouseholds`, every query filters by
 * the Firm (#42 adds row-level security), so another Firm's Household is as unknown as one that
 * doesn't exist.
 */
export async function getHouseholdOverview(
  db: Database,
  { firmId, publicId }: { firmId: number; publicId: string },
): Promise<HouseholdOverview | null> {
  // Postgres refuses to compare a `uuid` column with text that isn't one.
  if (!PublicId.safeParse(publicId).success) return null;

  const thisHousehold = and(eq(household.firmId, firmId), eq(household.publicId, publicId));
  const latestAsOf = db
    .select({ asOf: max(custodianDelivery.asOfDate) })
    .from(custodianDelivery)
    .where(eq(custodianDelivery.firmId, firmId));
  // Account roles are dated: the ones that count have started by the latest As-of date, the day
  // the Positions describe, or, before the first Delivery, by today (UTC).
  const today = new Date().toISOString().slice(0, 10);
  const rolesOn = sql<string>`coalesce((${latestAsOf}), ${today}::date)`;
  const started = lte(accountRole.startsOn, rolesOn);
  const [[found], members, owned, [latest]] = await Promise.all([
    db.select().from(household).where(thisHousehold),
    db
      .select({ role: householdMember.role, person })
      .from(householdMember)
      .innerJoin(household, and(thisHousehold, eq(household.id, householdMember.householdId)))
      .innerJoin(person, and(eq(person.id, householdMember.personId), eq(person.firmId, firmId)))
      .where(eq(householdMember.firmId, firmId))
      .orderBy(asc(person.id)),
    db
      .selectDistinct({ account: custodialAccount })
      .from(accountRole)
      .innerJoin(
        householdMember,
        and(eq(householdMember.personId, accountRole.personId), eq(householdMember.firmId, firmId)),
      )
      .innerJoin(household, and(thisHousehold, eq(household.id, householdMember.householdId)))
      .innerJoin(
        custodialAccount,
        and(eq(custodialAccount.id, accountRole.accountId), eq(custodialAccount.firmId, firmId)),
      )
      .where(
        and(
          eq(accountRole.firmId, firmId),
          inArray(accountRole.role, HOUSEHOLD_ACCOUNT_ROLES),
          started,
        ),
      )
      .orderBy(asc(custodialAccount.accountNumber)),
    latestAsOf,
  ]);
  if (!found) return null;

  const asOf = latest?.asOf ?? null;
  const accountIds = owned.map((row) => row.account.id);
  const [roles, positions] =
    accountIds.length === 0
      ? [[], []]
      : await Promise.all([
          // Everyone named on the Account, in this Household or not.
          db
            .select({ accountId: accountRole.accountId, role: accountRole, person })
            .from(accountRole)
            .innerJoin(person, and(eq(person.id, accountRole.personId), eq(person.firmId, firmId)))
            .where(
              and(
                eq(accountRole.firmId, firmId),
                inArray(accountRole.accountId, accountIds),
                started,
              ),
            )
            .orderBy(asc(accountRole.startsOn), asc(accountRole.id)),
          asOf === null
            ? []
            : db
                .select({ position: custodialPosition, security })
                .from(custodialPosition)
                .innerJoin(
                  security,
                  and(eq(security.id, custodialPosition.securityId), eq(security.firmId, firmId)),
                )
                .where(
                  and(
                    eq(custodialPosition.firmId, firmId),
                    eq(custodialPosition.asOfDate, asOf),
                    inArray(custodialPosition.accountId, accountIds),
                  ),
                )
                .orderBy(asc(security.identifier)),
        ]);

  // The Primary first, then the Co-client, then the Dependents.
  const people = HOUSEHOLD_ROLES.flatMap((role) => members.filter((row) => row.role === role));
  // An Account's roles in the same order, then anyone named on it from outside the Household.
  const rank = new Map(people.map((row, index) => [row.person.id, index]));
  const byRank = (row: (typeof roles)[number]) => rank.get(row.person.id) ?? people.length;
  const rolesOf = Map.groupBy(
    roles.toSorted((a, b) => byRank(a) - byRank(b)),
    (row) => row.accountId,
  );
  const positionsOf = Map.groupBy(positions, (row) => row.position.accountId);

  return {
    publicId: found.publicId,
    name: found.name,
    relationshipStatus: found.relationshipStatus,
    asOf,
    people: people.map((row) => toOverviewPerson({ row: row.person, householdRole: row.role })),
    accounts: owned.map(({ account }) =>
      toOverviewAccount({
        row: account,
        roles: (rolesOf.get(account.id) ?? []).map((row) => ({
          person: toOverviewPersonName(row.person),
          role: row.role.role,
        })),
        positions: (positionsOf.get(account.id) ?? []).map((row) =>
          toPublicPosition({ row: row.position, security: row.security }),
        ),
      }),
    ),
  };
}
