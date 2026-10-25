import type { Database } from "@repo/db";
import {
  ACCOUNT_ROLES,
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
  type NamedOnRole,
  toNamedOnAccount,
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
 * The other roles: the overview lists an Account a member holds one of under that member, as a
 * Named-on Account, and never counts it (docs/research/related-accounts-on-platforms.md).
 */
const isNamedOnRole = (role: AccountRoleKind): role is NamedOnRole =>
  !new Set<AccountRoleKind>(HOUSEHOLD_ACCOUNT_ROLES).has(role);
const NAMED_ON_ROLES = ACCOUNT_ROLES.filter(isNamedOnRole);

/**
 * The Household `publicId` of the Firm `firmId`, with its People (each with their Named-on
 * Accounts), the Accounts they own (each once, with every Account role on it), and each Account's
 * Positions on the Firm's latest As-of date, or null when the Firm has no such Household. Like
 * `listHouseholds`, every query filters by the Firm (#42 adds row-level security), so another
 * Firm's Household is as unknown as one that doesn't exist.
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
  const [[found], members, owned, namedOn, [latest]] = await Promise.all([
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
    // Distinct, since the same role can start twice on one Account.
    db
      .selectDistinct({
        personId: accountRole.personId,
        role: accountRole.role,
        account: custodialAccount,
      })
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
        and(eq(accountRole.firmId, firmId), inArray(accountRole.role, NAMED_ON_ROLES), started),
      )
      .orderBy(asc(custodialAccount.accountNumber)),
    latestAsOf,
  ]);
  if (!found) return null;

  const asOf = latest?.asOf ?? null;
  const accountIds = owned.map((row) => row.account.id);
  // An Account the Household owns is in `accounts` already, with every role on it.
  const namedOnly = namedOn
    .flatMap(({ personId, role, account }) =>
      isNamedOnRole(role) && !accountIds.includes(account.id) ? [{ personId, role, account }] : [],
    )
    .toSorted(
      (a, b) =>
        a.account.accountNumber.localeCompare(b.account.accountNumber) ||
        ACCOUNT_ROLES.indexOf(a.role) - ACCOUNT_ROLES.indexOf(b.role),
    );
  const namedOnIds = [...new Set(namedOnly.map((row) => row.account.id))];
  const [roles, positions, owners] = await Promise.all([
    accountIds.length === 0
      ? []
      : // Everyone named on the Account, in this Household or not.
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
    accountIds.length === 0 || asOf === null
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
    namedOnIds.length === 0
      ? []
      : // The Households of each Named-on Account's owners. Rule 3 of
        // docs/research/household-accounts.md puts an Account whose owners are in two Households in
        // the `owner` role's, so that one comes first.
        db
          .select({ accountId: accountRole.accountId, household })
          .from(accountRole)
          .innerJoin(
            householdMember,
            and(
              eq(householdMember.personId, accountRole.personId),
              eq(householdMember.firmId, firmId),
            ),
          )
          .innerJoin(
            household,
            and(eq(household.id, householdMember.householdId), eq(household.firmId, firmId)),
          )
          .where(
            and(
              eq(accountRole.firmId, firmId),
              inArray(accountRole.accountId, namedOnIds),
              inArray(accountRole.role, HOUSEHOLD_ACCOUNT_ROLES),
              started,
            ),
          )
          .orderBy(sql`${accountRole.role} <> 'owner'`, asc(household.id)),
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
  const ownersOf = Map.groupBy(owners, (row) => row.accountId);
  const namedOnOf = Map.groupBy(namedOnly, (row) => row.personId);

  return {
    publicId: found.publicId,
    name: found.name,
    relationshipStatus: found.relationshipStatus,
    asOf,
    people: people.map((row) =>
      toOverviewPerson({
        row: row.person,
        householdRole: row.role,
        namedOnAccounts: (namedOnOf.get(row.person.id) ?? []).map(({ account, role }) =>
          toNamedOnAccount({
            row: account,
            role,
            owningHousehold: ownersOf.get(account.id)?.[0]?.household ?? null,
          }),
        ),
      }),
    ),
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
