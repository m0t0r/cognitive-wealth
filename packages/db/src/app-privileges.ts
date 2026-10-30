// What the `app` role may do to each table in `public`. `app` gets no default privileges, so a
// migration grants each table what's listed here, and `app-privileges.integration.test.ts` fails
// when the catalog and this list differ. Grant only what code uses today: the feature that first
// needs more adds it, in its own migration (#189).

type Privilege = "select" | "insert" | "update" | "delete";

export type TablePrivileges = {
  /** Privileges on the whole table. */
  onTable: Privilege[];
  /** Privileges on some columns only, such as an `update` that may change only these. */
  columns?: Partial<Record<Privilege, string[]>>;
};

// Better Auth's tables: it creates, refreshes and deletes sessions, sign-in codes and memberships.
const BETTER_AUTH: TablePrivileges = { onTable: ["select", "insert", "update", "delete"] };
// Facts: rows are added and read, never changed or removed (`audit_event`, the Custodian feed).
const APPEND_ONLY: TablePrivileges = { onTable: ["select", "insert"] };
// Earlier versions, which only the `record_history()` trigger writes (ADR 0025).
const HISTORY: TablePrivileges = { onTable: ["select"] };

export const APP_PRIVILEGES: Record<string, TablePrivileges> = {
  account: BETTER_AUTH,
  invitation: BETTER_AUTH,
  member: BETTER_AUTH,
  organization: BETTER_AUTH,
  session: BETTER_AUTH,
  user: BETTER_AUTH,
  verification: BETTER_AUTH,

  audit_event: APPEND_ONLY,
  custodian_delivery: APPEND_ONLY,
  custodial_position: APPEND_ONLY,
  custodial_transaction: APPEND_ONLY,
  security_price: APPEND_ONLY,

  // Only the seed writes these today, and it only inserts.
  household: APPEND_ONLY,
  person: APPEND_ONLY,
  // Ended, never deleted (#192): an end date is all that changes, and each change keeps the old
  // version in the table's history (ADR 0025).
  account_role: { onTable: ["select", "insert"], columns: { update: ["ends_on"] } },
  household_member: { onTable: ["select", "insert"], columns: { update: ["ends_on"] } },
  account_role_history: HISTORY,
  household_member_history: HISTORY,

  // Ingestion brings these up to date from each Delivery (#126), but never their identifiers, and
  // each change keeps the old version in the table's history (ADR 0025).
  custodial_account: {
    onTable: ["select", "insert"],
    columns: { update: ["registration_type", "opened_on", "updated_at"] },
  },
  security: {
    onTable: ["select", "insert"],
    columns: { update: ["name", "kind", "updated_at"] },
  },
  custodial_account_history: HISTORY,
  security_history: HISTORY,
  // The seed's record of the world file it last loaded, replaced on each changed file.
  world_seed: {
    onTable: ["select", "insert"],
    columns: { update: ["world_hash", "seeded_at"] },
  },
};
