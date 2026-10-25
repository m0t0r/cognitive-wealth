// What leaves this package: plain objects with `publicId`s, never internal ids or the Firm's id
// (ADR 0003).
import type {
  AccountRoleKind,
  HouseholdRole,
  RegistrationType,
  RelationshipStatus,
  accountRole,
  custodialAccount,
  custodialPosition,
  household,
  person,
  security,
} from "@repo/db/schema";

export type { AccountRoleKind, HouseholdRole, RegistrationType, RelationshipStatus };

export interface PublicAccount {
  publicId: string;
  accountNumber: string;
  /** Null until the Custodian feed has been ingested (ADR 0009). */
  registrationType: RegistrationType | null;
}

export interface PublicAccountRole {
  account: PublicAccount;
  role: AccountRoleKind;
  /** An ISO date, `YYYY-MM-DD`. */
  startsOn: string;
}

export interface PublicPerson {
  publicId: string;
  firstName: string;
  lastName: string;
  /** An ISO date, `YYYY-MM-DD`. */
  bornOn: string;
  householdRole: HouseholdRole;
  accountRoles: PublicAccountRole[];
}

export interface PublicHousehold {
  publicId: string;
  name: string;
  relationshipStatus: RelationshipStatus;
  /** The Primary first, then the Co-client, then the Dependents. */
  people: PublicPerson[];
}

type HouseholdRow = typeof household.$inferSelect;
type PersonRow = typeof person.$inferSelect;
type AccountRow = typeof custodialAccount.$inferSelect;
type AccountRoleRow = typeof accountRole.$inferSelect;

export function toPublicAccount(row: AccountRow): PublicAccount {
  return {
    publicId: row.publicId,
    accountNumber: row.accountNumber,
    registrationType: row.registrationType,
  };
}

export function toPublicAccountRole({
  row,
  account,
}: {
  row: AccountRoleRow;
  account: AccountRow;
}): PublicAccountRole {
  return { account: toPublicAccount(account), role: row.role, startsOn: row.startsOn };
}

export function toPublicPerson({
  row,
  householdRole,
  accountRoles,
}: {
  row: PersonRow;
  householdRole: HouseholdRole;
  accountRoles: PublicAccountRole[];
}): PublicPerson {
  return {
    publicId: row.publicId,
    firstName: row.firstName,
    lastName: row.lastName,
    bornOn: row.bornOn,
    householdRole,
    accountRoles,
  };
}

export function toPublicHousehold({
  row,
  people,
}: {
  row: HouseholdRow;
  people: PublicPerson[];
}): PublicHousehold {
  return {
    publicId: row.publicId,
    name: row.name,
    relationshipStatus: row.relationshipStatus,
    people,
  };
}

// The Household overview (#41): one Household as an Advisor reads it, with each Account's
// Positions as the Custodian reported them on the latest As-of date.

/** A Person by name, where the overview names who holds an Account role. */
export interface OverviewPersonName {
  publicId: string;
  firstName: string;
  lastName: string;
}

export interface OverviewPerson extends OverviewPersonName {
  householdRole: HouseholdRole;
}

export interface OverviewAccountRole {
  person: OverviewPersonName;
  role: AccountRoleKind;
}

export interface PublicSecurity {
  publicId: string;
  identifier: string;
  name: string;
}

/** Amounts are the Custodian's own decimal strings (ADR 0013), never recomputed. */
export interface PublicPosition {
  publicId: string;
  security: PublicSecurity;
  shares: string;
  /** Null, like `marketValue`, when the Security had no price yet (ADR 0016). */
  price: string | null;
  marketValue: string | null;
}

export interface OverviewAccount {
  publicId: string;
  /**
   * The account number's last four characters. The full number never leaves the server: the
   * overview only needs to tell the Accounts apart, and a page shows it masked.
   */
  accountNumberEnding: string;
  /** Null until the Custodian feed has been ingested (ADR 0009). */
  registrationType: RegistrationType | null;
  /**
   * Everyone named on the Account by the same date: the Household's People in its role order (the
   * Primary's first), then anyone from outside it.
   */
  roles: OverviewAccountRole[];
  /** On the overview's `asOf`, by Security identifier; empty before the first Delivery. */
  positions: PublicPosition[];
}

export interface HouseholdOverview {
  publicId: string;
  name: string;
  relationshipStatus: RelationshipStatus;
  /**
   * The As-of date of the Firm's latest ingested Delivery, an ISO date (`YYYY-MM-DD`), or null
   * before the first. Every Delivery holds every Position, so this is each Account's latest.
   */
  asOf: string | null;
  /** The Primary first, then the Co-client, then the Dependents. */
  people: OverviewPerson[];
  /**
   * The Accounts a Person in the Household owns or jointly owns, each once, by account number,
   * counting only roles that have started by `asOf` (by today, before the first Delivery). An
   * Account a member is only named on (as Beneficiary, custodian for a minor or power of attorney)
   * stays with its owner's Household (docs/research/household-accounts.md).
   */
  accounts: OverviewAccount[];
}

type SecurityRow = typeof security.$inferSelect;
type PositionRow = typeof custodialPosition.$inferSelect;

export function toOverviewPersonName(row: PersonRow): OverviewPersonName {
  return { publicId: row.publicId, firstName: row.firstName, lastName: row.lastName };
}

export function toOverviewPerson({
  row,
  householdRole,
}: {
  row: PersonRow;
  householdRole: HouseholdRole;
}): OverviewPerson {
  return { ...toOverviewPersonName(row), householdRole };
}

export function toPublicPosition({
  row,
  security,
}: {
  row: PositionRow;
  security: SecurityRow;
}): PublicPosition {
  return {
    publicId: row.publicId,
    security: {
      publicId: security.publicId,
      identifier: security.identifier,
      name: security.name,
    },
    shares: row.shares,
    price: row.price,
    marketValue: row.marketValue,
  };
}

export function toOverviewAccount({
  row,
  roles,
  positions,
}: {
  row: AccountRow;
  roles: OverviewAccountRole[];
  positions: PublicPosition[];
}): OverviewAccount {
  return {
    publicId: row.publicId,
    accountNumberEnding: row.accountNumber.slice(-4),
    registrationType: row.registrationType,
    roles,
    positions,
  };
}
