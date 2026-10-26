// Which tables hold a Firm's records, and which don't (#206): what `pnpm org:export` writes into a
// Records export (GLOSSARY.md), and later what retention covers (#194). Kept as data, beside the
// schema, so a new table has to be put in one list or the other: `records.test.ts` fails until it
// is.

/**
 * How a table's rows are found for one Firm:
 * - `organization`: the Firm's own row (`id`);
 * - `organization_id`: Better Auth's tables and `audit_event`, by their `organization_id`;
 * - `firm_id`: Cognitive Wealth's Firm-scoped tables (`firmId()`);
 * - `firm_users`: the Users the Firm's exported rows name, which are its past and present members.
 *   A removed member's `member` row is deleted, and `org.member.removed` names only the membership,
 *   so a past member is found through what they left in the Firm: an invitation they sent, or an
 *   audit event they're the actor of. Anyone who joined by invitation is the actor of its
 *   `org.invitation.accepted`, and the invitation keeps their email. The one past member this can
 *   miss is an owner made by `pnpm org:create` (whose event has no actor) who was removed without
 *   ever acting in the Firm.
 */
export type RecordScope = "organization" | "organization_id" | "firm_id" | "firm_users";

export type RecordTable = {
  table: string;
  scope: RecordScope;
  /** What the file holds, for the export's README. */
  description: string;
  /** Only these columns, in this order; every column when omitted. */
  columns?: readonly string[];
};

export type ExcludedTable = { table: string; reason: string };

/** The tables a Records export holds, in the order it writes them: the Firm first, then its rows. */
export const RECORD_TABLES: readonly RecordTable[] = [
  {
    table: "organization",
    scope: "organization",
    description:
      "The Firm itself: its name, slug, when it was created and when it was deactivated.",
  },
  {
    table: "member",
    scope: "organization_id",
    description: "The Firm's present members and their role.",
  },
  {
    table: "invitation",
    scope: "organization_id",
    description: "Invitations into the Firm, whatever became of them, and who sent each.",
  },
  {
    table: "user",
    scope: "firm_users",
    description:
      "The name and email address of every User the other files name: present members, and past " +
      "members through the invitations they sent or accepted and the audit events they acted in.",
    // The rest of a User's row (email verification, image, timestamps) is their account with
    // Cognitive Wealth, not the Firm's record. `id` stays, since `member.user_id`,
    // `invitation.inviter_id` and `audit_event.actor_user_id` point at it.
    columns: ["id", "name", "email"],
  },
  {
    table: "audit_event",
    scope: "organization_id",
    description: "The Firm's audit trail: who did what, and when.",
  },
  { table: "household", scope: "firm_id", description: "Households." },
  { table: "person", scope: "firm_id", description: "People: the Firm's clients and prospects." },
  {
    table: "household_member",
    scope: "firm_id",
    description: "Which Person is in which Household, and in what role.",
  },
  {
    table: "custodial_account",
    scope: "firm_id",
    description: "Accounts at the Custodian, by account number.",
  },
  {
    table: "account_role",
    scope: "firm_id",
    description: "How each Person holds each Account (owner, beneficiary, …), and since when.",
  },
  {
    table: "custodian_delivery",
    scope: "firm_id",
    description: "Each Delivery of the Custodian feed that was loaded, by As-of date.",
  },
  {
    table: "security",
    scope: "firm_id",
    description: "The Security master: every Security the Custodian reported.",
  },
  {
    table: "custodial_transaction",
    scope: "firm_id",
    description: "Transactions, as the Custodian posted them.",
  },
  {
    table: "custodial_position",
    scope: "firm_id",
    description: "Positions, as the Custodian reported them, per Account, Security and As-of date.",
  },
  {
    table: "security_price",
    scope: "firm_id",
    description: "Security prices, per As-of date.",
  },
];

/** The tables a Records export leaves out, each with why. */
export const EXCLUDED_TABLES: readonly ExcludedTable[] = [
  { table: "session", reason: "Sign-in plumbing: who is signed in on which device, not a record." },
  {
    table: "verification",
    reason: "Sign-in plumbing: one-time sign-in tokens that expire within minutes.",
  },
  {
    table: "account",
    reason: "Sign-in plumbing: a User's sign-in methods with Cognitive Wealth, not a record.",
  },
  {
    table: "world_seed",
    reason: "Dev seed bookkeeping: which world file `pnpm db:seed` last loaded, not a record.",
  },
];
