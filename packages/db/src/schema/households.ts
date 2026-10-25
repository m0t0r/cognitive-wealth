// Households, the People in them, their Accounts and how People hold those Accounts (GLOSSARY.md,
// "Households" and "Accounts and custody"). Every row carries its Firm in `firm_id`, and every link
// between two rows is a foreign key on (firm_id, id), so a row can only point at its own Firm's
// rows. Queries still filter by Firm themselves: there is no row-level security yet (#42).
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
import { createdAt, id, publicId, updatedAt } from "./_helpers";
import { organization } from "./organization";

const oneOf = (column: unknown, values: readonly string[]) =>
  sql`${column} in (${sql.raw(values.map((value) => `'${value}'`).join(", "))})`;

/** GLOSSARY.md, "Relationship status". */
export const RELATIONSHIP_STATUSES = ["prospect", "client", "former_client"] as const;
/** GLOSSARY.md: "Primary", "Co-client" and "Dependent". */
export const HOUSEHOLD_ROLES = ["primary", "co_client", "dependent"] as const;
/** GLOSSARY.md, "Registration type": the ones the world file uses so far. */
export const REGISTRATION_TYPES = [
  "individual",
  "joint",
  "traditional_ira",
  "roth_ira",
  "custodial",
  "529",
] as const;
/** GLOSSARY.md, "Account role". */
export const ACCOUNT_ROLES = [
  "owner",
  "joint_owner",
  "custodian",
  "beneficiary",
  "power_of_attorney",
] as const;

const firmId = () =>
  bigint("firm_id", { mode: "number" })
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" });

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
    // The target of the (firm_id, id) foreign keys; also serves lookups by Firm.
    unique("household_firm_id_id_unique").on(t.firmId, t.id),
    unique("household_firm_id_seed_key_unique").on(t.firmId, t.seedKey),
    check(
      "household_relationship_status_check",
      oneOf(t.relationshipStatus, RELATIONSHIP_STATUSES),
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
    check("household_member_role_check", oneOf(t.role, HOUSEHOLD_ROLES)),
  ],
);

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
  {
    id: id(),
    publicId: publicId(),
    firmId: firmId(),
    accountNumber: text("account_number").notNull(),
    // Null until the Custodian feed is ingested.
    registrationType: text("registration_type", { enum: REGISTRATION_TYPES }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("custodial_account_firm_id_id_unique").on(t.firmId, t.id),
    unique("custodial_account_firm_id_account_number_unique").on(t.firmId, t.accountNumber),
    check(
      "custodial_account_registration_type_check",
      oneOf(t.registrationType, REGISTRATION_TYPES),
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
    check("account_role_role_check", oneOf(t.role, ACCOUNT_ROLES)),
  ],
);
