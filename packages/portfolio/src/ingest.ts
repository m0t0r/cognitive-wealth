import { createHash } from "node:crypto";
import {
  AccountRow,
  Manifest,
  type ManifestOutput,
  PositionRow,
  PriceRow,
  SecurityRow,
  TransactionRow,
} from "@repo/custodian-client/schemas";
import type { Database } from "@repo/db";
import {
  custodialAccount,
  custodialPosition,
  custodialTransaction,
  custodianDelivery,
  security,
  securityPrice,
} from "@repo/db/schema";
import { parse } from "csv-parse/sync";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { ZodType, z } from "zod";
import { type FeedSource, deliveryKey } from "./feed-source";

/** Why a Delivery was refused. Nothing is written for any of them. */
export type RefusalReason =
  /** No `manifest.json` yet: the Delivery isn't finished. Try again later. */
  | "not_delivered"
  /** A different Delivery for an As-of date already ingested. Phase 2 handles these. */
  | "restatement"
  /** `manifest.json` isn't a Manifest this reads, or is for another day. */
  | "invalid_manifest"
  /**
   * A file is missing, or its row count or Content hash isn't the Manifest's. It may be mid-write
   * (the store writes the Manifest last, so a rewrite can leave new files beside an old one), so
   * try again later before reporting it.
   */
  | "incomplete"
  /** A row isn't what the contract allows, or names something its Delivery doesn't. */
  | "invalid_rows"
  /** An account number the Firm has no Account for. */
  | "unknown_accounts"
  /** A Transaction ID an earlier Delivery already carried: the Custodian sends each once. */
  | "transactions_already_ingested";

export type IngestionResult =
  | {
      status: "ingested";
      asOf: string;
      manifestSha256: string;
      /** Rows added or brought up to date, by what they are. */
      written: {
        securities: number;
        accounts: number;
        transactions: number;
        positions: number;
        prices: number;
      };
    }
  /** This very Delivery (the same Manifest hash) was ingested before, so nothing was written. */
  | { status: "already_ingested"; asOf: string; manifestSha256: string }
  | { status: "refused"; asOf: string; reason: RefusalReason; message: string };

/** The five data files of a Delivery and the contract's schema for each one's rows. */
const FILES = {
  "securities.csv": SecurityRow,
  "accounts.csv": AccountRow,
  "transactions.csv": TransactionRow,
  "positions.csv": PositionRow,
  "prices.csv": PriceRow,
} as const satisfies Record<string, ZodType>;

type FileName = keyof typeof FILES;
// By name, as the Manifest lists them, so a refusal names problems in the Manifest's order.
const FILE_NAMES: readonly FileName[] = [
  "accounts.csv",
  "positions.csv",
  "prices.csv",
  "securities.csv",
  "transactions.csv",
];
type RowsOf<Name extends FileName> = z.output<(typeof FILES)[Name]>[];
type CsvRecord = Record<string, string | null>;

interface Rows {
  securities: RowsOf<"securities.csv">;
  accounts: RowsOf<"accounts.csv">;
  transactions: RowsOf<"transactions.csv">;
  positions: RowsOf<"positions.csv">;
  prices: RowsOf<"prices.csv">;
}

/** At most this many problems are named in a refusal; the rest are counted. */
const PROBLEMS_SHOWN = 10;

// Thrown inside the database transaction, so it rolls back, and returned as a `refused` result.
class Refusal extends Error {
  readonly reason: RefusalReason;
  constructor(reason: RefusalReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

/**
 * Ingestion (GLOSSARY.md): loads the Firm's Delivery for the As-of date `asOf` from `source` into
 * the database, in one database transaction, or writes nothing. The checks run in the feed
 * primer's order (docs/learn/03-custodian-feed-and-ingestion.md, Part 5): a Manifest, then that
 * the Delivery and its day are new, then every file against the Manifest, then every row against
 * the contract and every account number against the Firm's Accounts.
 *
 * Idempotent: the same Delivery again writes nothing and says `already_ingested`. Framework-
 * agnostic, so `pnpm custodian:ingest` and the background job (#56) share it.
 */
export async function ingestDelivery(
  db: Database,
  input: { firmId: number; asOf: string; source: FeedSource },
): Promise<IngestionResult> {
  try {
    return await ingestOnce(db, input);
  } catch (error) {
    // Another run wrote this day's Delivery after this one checked. Run again: it now finds that
    // Delivery and says `already_ingested` or refuses a Restatement, like any later run.
    if (isDeliveryConflict(error)) return ingestOnce(db, input);
    throw error;
  }
}

/** The unique violation a second, concurrent run of the same day ends with. */
function isDeliveryConflict(error: unknown): boolean {
  const cause = error instanceof Error ? error.cause : undefined;
  return (
    typeof cause === "object" &&
    cause !== null &&
    "constraint_name" in cause &&
    cause.constraint_name === "custodian_delivery_firm_id_as_of_date_unique"
  );
}

async function ingestOnce(
  db: Database,
  { firmId, asOf, source }: { firmId: number; asOf: string; source: FeedSource },
): Promise<IngestionResult> {
  try {
    return await db.transaction(async (tx) => {
      const manifestBytes = await source.get(deliveryKey(asOf, "manifest.json"));
      if (!manifestBytes) {
        throw new Refusal("not_delivered", `No manifest.json for ${asOf} yet`);
      }
      const manifestSha256 = sha256(manifestBytes);

      const [earlier] = await tx
        .select({ manifestSha256: custodianDelivery.manifestSha256 })
        .from(custodianDelivery)
        .where(and(eq(custodianDelivery.firmId, firmId), eq(custodianDelivery.asOfDate, asOf)));
      if (earlier?.manifestSha256 === manifestSha256) {
        return { status: "already_ingested", asOf, manifestSha256 } as const;
      }
      if (earlier) {
        throw new Refusal(
          "restatement",
          `A different Delivery for ${asOf} was already ingested (Manifest ` +
            `${earlier.manifestSha256}, now ${manifestSha256}); restatements aren't handled yet`,
        );
      }

      const manifest = parseManifest(manifestBytes, asOf);
      const files = await checkedFiles(source, manifest);
      const rows = validRows(files, asOf);
      const accountIds = await requireKnownAccounts(tx, firmId, rows);
      await refuseRepeatedTransactions(tx, firmId, rows.transactions);

      const written = await write(tx, firmId, asOf, manifestSha256, rows, accountIds);
      return { status: "ingested", asOf, manifestSha256, written } as const;
    });
  } catch (error) {
    if (error instanceof Refusal) {
      return { status: "refused", asOf, reason: error.reason, message: error.message };
    }
    throw error;
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseManifest(bytes: Uint8Array, asOf: string): ManifestOutput {
  let json: unknown;
  try {
    json = JSON.parse(utf8(bytes));
  } catch {
    throw new Refusal("invalid_manifest", `manifest.json for ${asOf} isn't JSON`);
  }
  const parsed = Manifest.safeParse(json);
  if (!parsed.success) {
    throw new Refusal(
      "invalid_manifest",
      `manifest.json for ${asOf} isn't a Manifest this reads: ${describeIssues(parsed.error)}`,
    );
  }
  const manifest = parsed.data;
  if (manifest.asOfDate !== asOf) {
    throw new Refusal(
      "invalid_manifest",
      `manifest.json in ${asOf}'s folder is for ${manifest.asOfDate}`,
    );
  }
  const listed = manifest.files.map((file) => file.name).toSorted();
  const expected = FILE_NAMES;
  if (listed.join() !== expected.join()) {
    throw new Refusal(
      "invalid_manifest",
      `manifest.json for ${asOf} lists ${listed.join(", ") || "no files"}, ` +
        `not ${expected.join(", ")}`,
    );
  }
  return manifest;
}

/**
 * Every data file the Manifest lists, as CSV records, once each one is there with the row count
 * and Content hash the Manifest gives it. Every file is checked before refusing, so the refusal
 * names all of them.
 */
async function checkedFiles(
  source: FeedSource,
  manifest: ManifestOutput,
): Promise<Map<FileName, CsvRecord[]>> {
  const listed = new Map(manifest.files.map((file) => [file.name, file]));
  // Each file's records, or what's wrong with it.
  const checked = await Promise.all(
    FILE_NAMES.map(async (name): Promise<[FileName, CsvRecord[] | string]> => {
      // parseManifest made sure the Manifest lists each of the five.
      const file = listed.get(name)!;
      const bytes = await source.get(deliveryKey(manifest.asOfDate, name));
      if (!bytes) return [name, `${name} is missing`];
      const records = csvRecords(bytes);
      if (typeof records === "string") return [name, `${name} isn't readable CSV: ${records}`];
      if (records.length !== file.rows) {
        return [name, `${name} has ${records.length} rows, the Manifest lists ${file.rows}`];
      }
      if (sha256(bytes) !== file.sha256)
        return [name, `${name}'s Content hash isn't the Manifest's`];
      return [name, records];
    }),
  );
  const problems = checked.flatMap(([, checks]) => (typeof checks === "string" ? [checks] : []));
  if (problems.length > 0) {
    throw new Refusal(
      "incomplete",
      `The Delivery for ${manifest.asOfDate} doesn't match its Manifest: ${joinProblems(problems)}`,
    );
  }
  return new Map(
    checked.flatMap(([name, checks]) =>
      typeof checks === "string" ? [] : [[name, checks] as const],
    ),
  );
}

/** A CSV file's rows keyed by its header row, an empty value read as null; or why it can't be. */
function csvRecords(bytes: Uint8Array): CsvRecord[] | string {
  try {
    const records: Record<string, string>[] = parse(utf8(bytes), { columns: true });
    return records.map((record) =>
      Object.fromEntries(Object.entries(record).map(([key, value]) => [key, value || null])),
    );
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Every row parsed with the contract's schema, refusing the Delivery if any row fails, names a
 * Security its Security master doesn't list, or was posted on another day: each snapshot is complete, and
 * `transactions.csv` holds only the Transactions posted on the As-of date (ADR 0017).
 */
function validRows(files: Map<FileName, CsvRecord[]>, asOf: string): Rows {
  const problems: string[] = [];
  const parseFile = <Name extends FileName>(name: Name): RowsOf<Name> =>
    (files.get(name) ?? []).flatMap((record, index) => {
      const result = FILES[name].safeParse(record);
      // TypeScript can't narrow a schema picked by a generic key to that key's output type.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      if (result.success) return [result.data as RowsOf<Name>[number]];
      // Row 1 is the header row, so the first data row is row 2, as a spreadsheet numbers it.
      problems.push(`${name} row ${index + 2}: ${describeIssues(result.error)}`);
      return [];
    });
  const rows: Rows = {
    securities: parseFile("securities.csv"),
    accounts: parseFile("accounts.csv"),
    transactions: parseFile("transactions.csv"),
    positions: parseFile("positions.csv"),
    prices: parseFile("prices.csv"),
  };
  if (problems.length > 0) refuseRows(asOf, problems);

  const securities = new Set(rows.securities.map((row) => row.identifier));
  const unlistedSecurity = (name: FileName, index: number, identifier: string | null) => {
    if (identifier !== null && !securities.has(identifier)) {
      problems.push(`${name} row ${index + 2}: Security ${identifier} isn't in securities.csv`);
    }
  };
  rows.transactions.forEach((row, index) => {
    unlistedSecurity("transactions.csv", index, row.security);
    if (row.postingDate !== asOf) {
      problems.push(
        `transactions.csv row ${index + 2}: posted on ${row.postingDate}, not on ${asOf}`,
      );
    }
  });
  rows.positions.forEach((row, index) => unlistedSecurity("positions.csv", index, row.security));
  rows.prices.forEach((row, index) => unlistedSecurity("prices.csv", index, row.security));
  if (problems.length > 0) refuseRows(asOf, problems);

  return rows;
}

function refuseRows(asOf: string, problems: string[]): never {
  throw new Refusal(
    "invalid_rows",
    `The Delivery for ${asOf} has invalid rows: ${joinProblems(problems)}`,
  );
}

/**
 * The Firm's Account id for each account number the Delivery names, in any file, refusing the Delivery if any
 * is unknown: every row must belong to an Account the Firm knows, so a person looks first.
 */
async function requireKnownAccounts(db: Database, firmId: number, rows: Rows) {
  const numbers = [
    ...new Set(
      [...rows.accounts, ...rows.transactions, ...rows.positions].map((row) => row.accountNumber),
    ),
  ];
  const found = numbers.length
    ? await db
        .select({ id: custodialAccount.id, accountNumber: custodialAccount.accountNumber })
        .from(custodialAccount)
        .where(
          and(
            eq(custodialAccount.firmId, firmId),
            inArray(custodialAccount.accountNumber, numbers),
          ),
        )
    : [];
  const ids = new Map(found.map((row) => [row.accountNumber, row.id]));
  const unknown = numbers.filter((number) => !ids.has(number)).toSorted();
  if (unknown.length > 0) {
    throw new Refusal(
      "unknown_accounts",
      `The Firm has no Account numbered ${joinProblems(unknown)}; add ${unknown.length === 1 ? "it" : "them"} ` +
        "to a Household before ingesting",
    );
  }
  return ids;
}

async function refuseRepeatedTransactions(
  db: Database,
  firmId: number,
  transactions: Rows["transactions"],
) {
  const ids = transactions.map((row) => row.transactionId);
  if (ids.length === 0) return;
  const repeated = await db
    .select({ transactionId: custodialTransaction.transactionId })
    .from(custodialTransaction)
    .where(
      and(
        eq(custodialTransaction.firmId, firmId),
        inArray(custodialTransaction.transactionId, ids),
      ),
    );
  if (repeated.length > 0) {
    throw new Refusal(
      "transactions_already_ingested",
      `An earlier Delivery already carried Transaction ` +
        joinProblems(repeated.map((row) => row.transactionId).toSorted()),
    );
  }
}

async function write(
  db: Database,
  firmId: number,
  asOf: string,
  manifestSha256: string,
  rows: Rows,
  accountIds: Map<string, number>,
): Promise<Extract<IngestionResult, { status: "ingested" }>["written"]> {
  const [delivery] = await db
    .insert(custodianDelivery)
    .values({ firmId, asOfDate: asOf, manifestSha256 })
    .returning({ id: custodianDelivery.id });
  const deliveryId = delivery!.id;

  // The Security master and the Accounts are snapshots: new ones are added, changed ones updated,
  // and unchanged ones left alone, so only what changed counts as written.
  const securities = rows.securities.length
    ? await db
        .insert(security)
        .values(
          rows.securities.map(({ identifier, name, kind }) => ({ firmId, identifier, name, kind })),
        )
        .onConflictDoUpdate({
          target: [security.firmId, security.identifier],
          set: { name: sql`excluded.name`, kind: sql`excluded.kind`, updatedAt: sql`now()` },
          setWhere: sql`(${security.name}, ${security.kind}) is distinct from (excluded.name, excluded.kind)`,
        })
        .returning({ id: security.id })
    : [];
  const updatedAccounts = await Promise.all(
    rows.accounts.map((row) =>
      db
        .update(custodialAccount)
        .set({ registrationType: row.registrationType, openedOn: row.openedOn })
        .where(
          and(
            eq(custodialAccount.id, accountIds.get(row.accountNumber)!),
            sql`(${custodialAccount.registrationType}, ${custodialAccount.openedOn}) is distinct from (${row.registrationType}, ${row.openedOn}::date)`,
          ),
        )
        .returning({ id: custodialAccount.id }),
    ),
  );
  const accounts = updatedAccounts.flat().length;

  const securityRows = await db
    .select({ id: security.id, identifier: security.identifier })
    .from(security)
    .where(
      and(
        eq(security.firmId, firmId),
        inArray(
          security.identifier,
          rows.securities.map((row) => row.identifier),
        ),
      ),
    );
  const securityIds = new Map(securityRows.map((row) => [row.identifier, row.id]));
  const securityId = (identifier: string) => securityIds.get(identifier)!;
  const accountId = (number: string) => accountIds.get(number)!;

  await inBatches(
    rows.transactions.map((row) => ({
      firmId,
      deliveryId,
      transactionId: row.transactionId,
      accountId: accountId(row.accountNumber),
      kind: row.kind,
      reverses: row.reverses,
      securityId: row.security === null ? null : securityId(row.security),
      shares: row.shares,
      amount: row.amount,
      tradeDate: row.tradeDate,
      settlementDate: row.settlementDate,
      postingDate: row.postingDate,
    })),
    (batch) => db.insert(custodialTransaction).values(batch),
  );
  await inBatches(
    rows.positions.map((row) => ({
      firmId,
      deliveryId,
      asOfDate: asOf,
      accountId: accountId(row.accountNumber),
      securityId: securityId(row.security),
      shares: row.shares,
      price: row.price,
      marketValue: row.marketValue,
    })),
    (batch) => db.insert(custodialPosition).values(batch),
  );
  await inBatches(
    rows.prices.map((row) => ({
      firmId,
      deliveryId,
      asOfDate: asOf,
      securityId: securityId(row.security),
      price: row.price,
    })),
    (batch) => db.insert(securityPrice).values(batch),
  );

  return {
    securities: securities.length,
    accounts,
    transactions: rows.transactions.length,
    positions: rows.positions.length,
    prices: rows.prices.length,
  };
}

// Postgres takes at most 65,535 parameters a statement, so a large file goes in batches.
const ROWS_PER_INSERT = 1000;

/** `insert` called on `values` a batch at a time, one after another. */
async function inBatches<T>(values: T[], insert: (batch: T[]) => PromiseLike<unknown>) {
  for (let start = 0; start < values.length; start += ROWS_PER_INSERT) {
    // One connection in a database transaction: the batches would queue one after another anyway.
    // oxlint-disable-next-line no-await-in-loop
    await insert(values.slice(start, start + ROWS_PER_INSERT));
  }
}

function utf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) =>
      issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
    )
    .join("; ");
}

/** `problems` joined for a message, the first few named and the rest counted. */
function joinProblems(problems: string[]): string {
  const shown = problems.slice(0, PROBLEMS_SHOWN).join("; ");
  const more = problems.length - PROBLEMS_SHOWN;
  return more > 0 ? `${shown}; and ${more} more` : shown;
}
