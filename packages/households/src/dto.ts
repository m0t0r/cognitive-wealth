// What leaves this package: plain objects with `publicId`s, never internal ids or the Firm's id
// (ADR 0003).
import type {
  ACCOUNT_ROLES,
  HOUSEHOLD_ROLES,
  REGISTRATION_TYPES,
  RELATIONSHIP_STATUSES,
} from "@repo/db/schema";

export type RelationshipStatus = (typeof RELATIONSHIP_STATUSES)[number];
export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number];
export type RegistrationType = (typeof REGISTRATION_TYPES)[number];
export type AccountRoleKind = (typeof ACCOUNT_ROLES)[number];

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

export function toPublicAccount(row: PublicAccount): PublicAccount {
  return {
    publicId: row.publicId,
    accountNumber: row.accountNumber,
    registrationType: row.registrationType,
  };
}
