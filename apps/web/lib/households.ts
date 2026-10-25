import type {
  AccountRoleKind,
  HouseholdRole,
  OverviewPersonName,
  RegistrationType,
  RelationshipStatus,
} from "@repo/households";

/** "Dana Reyes". */
export function personName({ firstName, lastName }: OverviewPersonName): string {
  return `${firstName} ${lastName}`;
}

// GLOSSARY.md's names for each value, as the page shows them.

export const RELATIONSHIP_STATUS_LABELS: Record<RelationshipStatus, string> = {
  prospect: "Prospect",
  client: "Client",
  former_client: "Former client",
};

export const HOUSEHOLD_ROLE_LABELS: Record<HouseholdRole, string> = {
  primary: "Primary",
  co_client: "Co-client",
  dependent: "Dependent",
};

export const ACCOUNT_ROLE_LABELS: Record<AccountRoleKind, string> = {
  owner: "Owner",
  joint_owner: "Joint owner",
  custodian: "Custodian for a minor",
  beneficiary: "Beneficiary",
  power_of_attorney: "Power of attorney",
};

export const REGISTRATION_TYPE_LABELS: Record<RegistrationType, string> = {
  individual: "Individual",
  joint: "Joint",
  traditional_ira: "Traditional IRA",
  roth_ira: "Roth IRA",
  custodial: "Custodial",
  "529": "529 plan",
};
