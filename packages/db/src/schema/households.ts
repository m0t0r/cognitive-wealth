// Households, the People in them, their Accounts and how People hold those Accounts (GLOSSARY.md,
// "Households" and "Accounts and custody"). Every row carries its Firm in `firm_id`, and every link
// between two rows is a foreign key on (firm_id, id), so a row can only point at its own Firm's
// rows. Each table also has row-level security (`firmIsolation()`, ADR 0020), and queries still
// filter by Firm themselves.
import { RegistrationType as RegistrationTypeSchema } from "@repo/custodian-client/schemas";
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { firmId, firmIsolation, knownValue, nonEmpty } from "./_domain";
import { createdAt, id, publicId, timestamptz, updatedAt } from "./_helpers";

/** GLOSSARY.md, "Relationship status". */
export const RELATIONSHIP_STATUSES = ["prospect", "client", "former_client"] as const;
/** GLOSSARY.md: "Primary", "Co-client" and "Dependent". */
export const HOUSEHOLD_ROLES = ["primary", "co_client", "dependent"] as const;
/**
 * GLOSSARY.md, "Registration type": the Custodian's fact about an Account, so the list is its
 * contract's (`RegistrationType` in `apps/custodian/openapi.json`), which Ingestion (#40) parses
 * `accounts.csv` with. The check constraint is frozen in a migration, so when the contract grows,
 * a new migration widens it; `schema.integration.test.ts` fails until one does.
 */
export const REGISTRATION_TYPES = nonEmpty(RegistrationTypeSchema.options);
/** GLOSSARY.md, "Account role". */
export const ACCOUNT_ROLES = [
  "owner",
  "joint_owner",
  "custodian",
  "beneficiary",
  "power_of_attorney",
] as const;

export type RelationshipStatus = (typeof RELATIONSHIP_STATUSES)[number];
export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number];
export type RegistrationType = (typeof REGISTRATION_TYPES)[number];
export type AccountRoleKind = (typeof ACCOUNT_ROLES)[number];

// The world file's key for a row (`reyes`, `dana-reyes`), which lets the seed find it again.
// Null for rows created any other way.
const seedKey = () => text("seed_key");

export const household = pgTable(
  "household",
  {
    id: id(),
    publicId: publicId(),
    firmId: firmId(),
    seedKey: seedKey(),
    name: text("name").notNull(),
    relationshipStatus: text("relationship_status", { enum: RELATIONSHIP_STATUSES }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    firmIsolation(),
    // The target of the (firm_id, id) foreign keys; also serves lookups by Firm.
    unique("household_firm_id_id_unique").on(t.firmId, t.id),
    unique("household_firm_id_seed_key_unique").on(t.firmId, t.seedKey),
    check(
      "household_relationship_status_check",
      knownValue(t.relationshipStatus, RELATIONSHIP_STATUSES),
    ),
  ],
);

export const person = pgTable(
  "person",
  {
    id: id(),
    publicId: publicId(),
    firmId: firmId(),
    seedKey: seedKey(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    bornOn: date("born_on", { mode: "string" }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    firmIsolation(),
    unique("person_firm_id_id_unique").on(t.firmId, t.id),
    unique("person_firm_id_seed_key_unique").on(t.firmId, t.seedKey),
  ],
);

/** A Person's place in a Household. At most one Primary and one Co-client per Household. */
export const householdMember = pgTable(
  "household_member",
  {
    id: id(),
    publicId: publicId(),
    firmId: firmId(),
    householdId: bigint("household_id", { mode: "number" }).notNull(),
    personId: bigint("person_id", { mode: "number" }).notNull(),
    role: text("role", { enum: HOUSEHOLD_ROLES }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    firmIsolation(),
    foreignKey({
      name: "household_member_household_fk",
      columns: [t.firmId, t.householdId],
      foreignColumns: [household.firmId, household.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "household_member_person_fk",
      columns: [t.firmId, t.personId],
      foreignColumns: [person.firmId, person.id],
    }).onDelete("cascade"),
    unique("household_member_household_id_person_id_unique").on(t.householdId, t.personId),
    // Any number of Dependents, so only the two leading roles are unique.
    uniqueIndex("household_member_household_id_lead_role_unique")
      .on(t.householdId, t.role)
      .where(sql`${t.role} <> 'dependent'`),
    index("household_member_person_id_idx").on(t.personId),
    check("household_member_role_check", knownValue(t.role, HOUSEHOLD_ROLES)),
  ],
);

/**
 * `custodial_account`'s columns besides `id` and `public_id`, which `custodial_account_history`
 * (history.ts) copies too, so a column added here is added to both (ADR 0025). Keep constraints
 * that would hold one version only, such as a unique one, in the table's extra config.
 */
export const custodialAccountColumns = () => ({
  firmId: firmId(),
  accountNumber: text("account_number").notNull(),
  // Both null until the Custodian feed is ingested.
  registrationType: text("registration_type", { enum: REGISTRATION_TYPES }),
  openedOn: date("opened_on", { mode: "string" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * An Account at the Custodian, known by its account number (GLOSSARY.md, "Account"). Named
 * `custodial_account` because Better Auth already owns `account` (a User's sign-in method).
 *
 * The Custodian is the book of record for Accounts (ADR 0009). The seed knows only the numbers its
 * Account roles name, so it writes the row with just that; the Custodian feed's `accounts.csv`
 * fills in the details on Ingestion (#40), finding the row by (firm_id, account_number).
 */
export const custodialAccount = pgTable(
  "custodial_account",
  { id: id(), publicId: publicId(), ...custodialAccountColumns() },
  (t) => [
    firmIsolation(),
    unique("custodial_account_firm_id_id_unique").on(t.firmId, t.id),
    unique("custodial_account_firm_id_account_number_unique").on(t.firmId, t.accountNumber),
    check(
      "custodial_account_registration_type_check",
      knownValue(t.registrationType, REGISTRATION_TYPES),
    ),
  ],
);

/** A dated link between a Person and an Account (GLOSSARY.md, "Account role"). */
export const accountRole = pgTable(
  "account_role",
  {
    id: id(),
    publicId: publicId(),
    firmId: firmId(),
    personId: bigint("person_id", { mode: "number" }).notNull(),
    accountId: bigint("account_id", { mode: "number" }).notNull(),
    role: text("role", { enum: ACCOUNT_ROLES }).notNull(),
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    firmIsolation(),
    foreignKey({
      name: "account_role_person_fk",
      columns: [t.firmId, t.personId],
      foreignColumns: [person.firmId, person.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "account_role_account_fk",
      columns: [t.firmId, t.accountId],
      foreignColumns: [custodialAccount.firmId, custodialAccount.id],
    }).onDelete("cascade"),
    unique("account_role_person_id_account_id_role_starts_on_unique").on(
      t.personId,
      t.accountId,
      t.role,
      t.startsOn,
    ),
    index("account_role_account_id_idx").on(t.accountId),
    check("account_role_role_check", knownValue(t.role, ACCOUNT_ROLES)),
  ],
);

/**
 * Which world file's CRM half `pnpm db:seed` last loaded into a Firm, as a SHA-256 of it. A rerun
 * with the same file skips the CRM half, so edits made in the app since are left alone; only a
 * changed file is compared row by row. Only the seed reads or writes it, and it never leaves the
 * server, so it has no `public_id`.
 */
export const worldSeed = pgTable(
  "world_seed",
  {
    id: id(),
    firmId: firmId().unique(),
    worldHash: text("world_hash").notNull(),
    seededAt: timestamptz("seeded_at").notNull().defaultNow(),
  },
  () => [firmIsolation()],
);
