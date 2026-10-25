// What leaves this package: plain objects with `publicId`s, never internal ids or the Firm's id
// (ADR 0003).
import type {
  AccountRoleKind,
  HouseholdRole,
  RegistrationType,
  RelationshipStatus,
  accountRole,
  custodialAccount,
  household,
  person,
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

export function toPublicAccountRole(row: AccountRoleRow, account: AccountRow): PublicAccountRole {
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

export function toPublicHousehold(row: HouseholdRow, people: PublicPerson[]): PublicHousehold {
  return {
    publicId: row.publicId,
    name: row.name,
    relationshipStatus: row.relationshipStatus,
    people,
  };
}
