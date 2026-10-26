// A Records export of one Firm (GLOSSARY.md, #206), as `cw org export` writes it: one CSV per
// table in `RECORD_TABLES`, `manifest.json` (the index) and `README.md`, read as `migrator` in one
// snapshot and audited as `org.records_exported`. Rule 204-2(g)(2) asks for records arranged for
// "easy location, access, and retrieval" and a "true and complete copy", and names no format, so
// it's CSV, which any spreadsheet or database opens. Imports the schema, so a Node entry loads this
// after `registerTsResolution()`.
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { finished } from "node:stream/promises";
import {
  type SQL,
  and,
  asc,
  count,
  eq,
  getTableColumns,
  getTableName,
  gt,
  inArray,
  or,
  sql,
} from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Database } from "../index.ts";
import { EXCLUDED_TABLES, RECORD_TABLES, type RecordTable } from "../records.ts";
import { auditEvent, invitation, member, organization } from "../schema/index.ts";
import { csvRow } from "./csv.ts";
import { CliError, normalizeSlug, parseReason } from "./organizations.ts";

/** Bumped when a file's layout changes, so a reader can tell which one it has. */
export const MANIFEST_VERSION = 1;

/** The role a Records export reads as: the tables' owner, which row-level security doesn't hold. */
const EXPORT_ROLE = "migrator";

/**
 * Rows read per query. A table is read in batches by `id` (each after the last one's), all in the
 * one snapshot, and written as they come, so no table is held in memory. Drizzle has no cursor on
 * postgres.js; every record table has an `id` primary key, so the batches cover it exactly.
 */
const BATCH_ROWS = 1000;

export type FirmState = "active" | "deactivated";

type Column = { name: string; type: string };

type ManifestFile = {
  file: string;
  table: string;
  rows: number;
  sha256: string;
  columns: Column[];
};

export type Manifest = {
  version: number;
  firm: {
    slug: string;
    publicId: string;
    name: string;
    state: FirmState;
    deactivatedAt: string | null;
  };
  /** When the snapshot was taken: the start of the transaction every file was read in. */
  exportedAt: string;
  files: ManifestFile[];
  excluded: { table: string; reason: string }[];
};

/** What `exportRecords` wrote, or with `dryRun` would write, for the CLI's output. */
export type RecordsExport = {
  out: string;
  firm: { slug: string; publicId: string; name: string };
  firmState: FirmState;
  exportedAt: Date;
  tables: { table: string; file: string; rows: number }[];
  /** `manifest.json`'s SHA-256; null for a dry run, which writes no manifest. */
  manifestHash: string | null;
  dryRun: boolean;
};

type ExportArgs = {
  slug: string;
  out: string;
  reason: string;
  /** Make the same checks and count each table's rows in the same snapshot; write nothing. */
  dryRun?: boolean | undefined;
};

/**
 * Writes the Firm `slug`'s Records export to `out`, active or deactivated. Every table is read in
 * one `repeatable read, read only` transaction as `migrator`, so the files are one snapshot and
 * Postgres refuses any write. The files go into a temporary folder beside `out` (mode 0700, files
 * 0600), the `org.records_exported` audit event is written, and only then is the folder moved to
 * `out`; a failure up to the audit write, that one included (`audit_failed`), removes the
 * temporary folder and throws. A failed move after it keeps the folder and names it. Throws
 * `CliError`, writing nothing, for an unknown slug (`unknown_organization`), a non-empty `out`
 * (`out_not_empty`) or another role (`wrong_role`). A dry run makes those checks and counts the
 * rows, and writes no file and no audit event.
 */
export async function exportRecords(db: Database, input: ExportArgs): Promise<RecordsExport> {
  const slug = normalizeSlug(input.slug);
  const reason = parseReason(input.reason);
  const out = resolve(input.out);
  await assertEmptyOrMissing(out);
  if (input.dryRun) return countRecords(db, { slug, out });
  await mkdir(dirname(out), { recursive: true });
  // Beside `out`, so the final move is a rename on the same file system. mkdtemp makes it 0700.
  const temp = await mkdtemp(join(dirname(out), `.${basename(out)}.partial-`));
  let exported: RecordsExport;
  try {
    const snapshot = await db.transaction((tx) => readSnapshot(tx, { slug, dir: temp }), {
      isolationLevel: "repeatable read",
      accessMode: "read only",
    });
    const { firm } = snapshot;
    const firmState: FirmState = firm.deactivatedAt === null ? "active" : "deactivated";
    const manifest: Manifest = {
      version: MANIFEST_VERSION,
      firm: {
        slug,
        publicId: firm.publicId,
        name: firm.name,
        state: firmState,
        deactivatedAt: firm.deactivatedAt,
      },
      exportedAt: snapshot.exportedAt,
      files: snapshot.files,
      excluded: EXCLUDED_TABLES.map(({ table, reason: why }) => ({
        table: getTableName(table),
        reason: why,
      })),
    };
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(join(temp, "manifest.json"), manifestText, { mode: 0o600, flag: "wx" });
    await writeFile(join(temp, "README.md"), recordsReadme(manifest), { mode: 0o600, flag: "wx" });
    const manifestHash = sha256(manifestText);
    const tables = Object.fromEntries(snapshot.files.map(({ table, rows }) => [table, rows]));

    // Inserted directly, so a failure throws (writeAuditEvent would swallow it): an export that
    // isn't in the audit trail isn't handed over.
    try {
      await db.insert(auditEvent).values({
        action: "org.records_exported",
        // The operator running the CLI isn't a user, so there's no actor.
        actorUserId: null,
        organizationId: firm.id,
        targetType: "organization",
        targetId: firm.publicId,
        metadata: { via: "cli", reason, firmState, tables, manifestHash },
      });
    } catch (error) {
      throw new CliError({
        code: "audit_failed",
        message:
          `Couldn't record the export in the audit trail, so nothing was written: ` +
          `${rootMessage(error)}. Fix that, then run it again.`,
      });
    }
    exported = {
      out,
      firm: { slug, publicId: firm.publicId, name: firm.name },
      firmState,
      exportedAt: new Date(snapshot.exportedAt),
      tables: snapshot.files.map(({ table, file, rows }) => ({ table, file, rows })),
      manifestHash,
      dryRun: false,
    };
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    throw error;
  }
  // The export is in the audit trail now, so a failed move keeps the files rather than deleting
  // what the trail says was made.
  try {
    await rename(temp, out);
  } catch (error) {
    throw new Error(
      `The export was made and audited (manifest sha256 ${exported.manifestHash}), but it couldn't ` +
        `be moved to ${out}: ${error instanceof Error ? error.message : String(error)}. ` +
        `Its files are in ${temp}; move that folder yourself.`,
      { cause: error },
    );
  }
  return exported;
}

/**
 * The innermost cause's message: Drizzle wraps a database error as "Failed query: <SQL> params:
 * <values>", which would print the audit metadata, and keeps Postgres's own reason as its cause.
 */
function rootMessage(error: unknown): string {
  let current = error;
  while (current instanceof Error && current.cause !== undefined) current = current.cause;
  return current instanceof Error ? current.message : String(current);
}

/** Refuses an `out` that exists and isn't an empty folder: an export never mixes with other files. */
async function assertEmptyOrMissing(out: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(out);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return;
    if (code === "ENOTDIR") {
      throw new CliError({
        code: "out_not_empty",
        message: `${out} exists and isn't a folder. Pick a new folder with --out; nothing was written.`,
      });
    }
    throw error;
  }
  if (entries.length > 0) {
    throw new CliError({
      code: "out_not_empty",
      message: `${out} isn't empty. Pick a new folder with --out; nothing was written.`,
    });
  }
}

type SnapshotFirm = { id: number; publicId: string; name: string; deactivatedAt: string | null };

type Snapshot = { firm: SnapshotFirm; exportedAt: string; files: ManifestFile[] };

type ReadSnapshotArgs = { slug: string; dir: string };

async function readSnapshot(tx: Database, { slug, dir }: ReadSnapshotArgs): Promise<Snapshot> {
  const { firm, exportedAt } = await snapshotFirm(tx, slug);
  const files: ManifestFile[] = [];
  for (const spec of RECORD_TABLES) {
    // One at a time: a transaction is one connection, which runs one query at a time.
    // oxlint-disable-next-line no-await-in-loop
    files.push(await writeTable(tx, { spec, firmId: firm.id, dir }));
  }
  return { firm, exportedAt, files };
}

/**
 * A dry run of `exportRecords`: each table's row count for the Firm, read in the same kind of
 * snapshot, as the same role, with the same refusals, and nothing written.
 */
async function countRecords(
  db: Database,
  { slug, out }: { slug: string; out: string },
): Promise<RecordsExport> {
  const { firm, exportedAt, tables } = await db.transaction(
    async (tx) => {
      const found = await snapshotFirm(tx, slug);
      const counted = [];
      for (const spec of RECORD_TABLES) {
        const table = getTableName(spec.table);
        // One at a time: a transaction is one connection, which runs one query at a time.
        // oxlint-disable-next-line no-await-in-loop
        const [row] = await tx
          .select({ rows: count() })
          .from(spec.table)
          .where(firmFilter(tx, { spec, firmId: found.firm.id }));
        counted.push({ table, file: `${table}.csv`, rows: row?.rows ?? 0 });
      }
      return { ...found, tables: counted };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  return {
    out,
    firm: { slug, publicId: firm.publicId, name: firm.name },
    firmState: firm.deactivatedAt === null ? "active" : "deactivated",
    exportedAt: new Date(exportedAt),
    tables,
    manifestHash: null,
    dryRun: true,
  };
}

/**
 * The Firm `slug` at the start of the snapshot, and that moment, refusing an unknown slug and any
 * role but `migrator`.
 */
async function snapshotFirm(
  tx: Database,
  slug: string,
): Promise<{ firm: SnapshotFirm; exportedAt: string }> {
  // Timestamps in UTC, whatever the server's default, so the files read the same anywhere.
  await tx.execute(sql`set local timezone = 'UTC'`);
  const [row] = await tx
    .select({
      id: organization.id,
      publicId: organization.publicId,
      name: organization.name,
      // As text, so the manifest keeps Postgres's microseconds.
      deactivatedAt: sql<string | null>`to_json(${organization.deactivatedAt}) #>> '{}'`,
      // The transaction's start: the moment of the snapshot.
      exportedAt: sql<string>`to_json(now()) #>> '{}'`,
      role: sql<string>`current_user`,
    })
    .from(organization)
    .where(eq(organization.slug, slug));
  if (row === undefined) {
    throw new CliError({
      code: "unknown_organization",
      message: `No organization has the slug "${slug}". Check the slug (organization.slug); nothing was written.`,
    });
  }
  if (row.role !== EXPORT_ROLE) {
    throw new CliError({
      code: "wrong_role",
      message:
        `Connected as ${row.role}, but a Records export reads as ${EXPORT_ROLE}, whom row-level ` +
        `security doesn't hold. Point DATABASE_URL and DATABASE_PASSWORD_FILE at ${EXPORT_ROLE}.`,
    });
  }
  const { exportedAt, role: _role, ...firm } = row;
  return { firm, exportedAt };
}

type WriteTableArgs = { spec: RecordTable; firmId: number; dir: string };

/** Writes one table's rows for the Firm into `<table>.csv`, batch by batch, hashing as it writes. */
async function writeTable(
  tx: Database,
  { spec, firmId, dir }: WriteTableArgs,
): Promise<ManifestFile> {
  const table = getTableName(spec.table);
  const columns = recordColumns(spec);
  const id = columnNamed({ spec, name: "id" });
  const firmRows = firmFilter(tx, { spec, firmId });
  // Every value as Postgres's own text form, so nothing is reshaped on the way: `numeric` keeps
  // its digits, `timestamptz` its microseconds, `jsonb` is JSON text.
  const selection = Object.fromEntries(
    columns.map((column) => [column.name, sql<string | null>`${column}::text`]),
  );
  const file = `${table}.csv`;
  const stream = createWriteStream(join(dir, file), { mode: 0o600, flags: "wx" });
  const hash = createHash("sha256");
  const write = async (chunk: string) => {
    hash.update(chunk);
    if (!stream.write(chunk)) await once(stream, "drain");
  };
  let rows = 0;
  try {
    await write(csvRow(columns.map(({ name }) => name)));
    let after: number | undefined;
    for (;;) {
      // Each batch waits for the one before: the next starts after its last `id`.
      // oxlint-disable-next-line no-await-in-loop
      const batch = await tx
        .select(selection)
        .from(spec.table)
        .where(after === undefined ? firmRows : and(firmRows, gt(id, after)))
        .orderBy(asc(id))
        .limit(BATCH_ROWS);
      if (batch.length === 0) break;
      // Waiting for the file to drain before the next batch is what keeps memory flat.
      // oxlint-disable-next-line no-await-in-loop
      await write(
        batch.map((values) => csvRow(columns.map(({ name }) => values[name] ?? null))).join(""),
      );
      rows += batch.length;
      after = Number(batch.at(-1)?.id);
    }
  } finally {
    stream.end();
    await finished(stream);
  }
  const described = columns.map((column) => ({ name: column.name, type: column.getSQLType() }));
  return { file, table, rows, sha256: hash.digest("hex"), columns: described };
}

/** The table's columns in schema order, narrowed to `spec.columns` (in that order) when it names some. */
function recordColumns(spec: RecordTable): PgColumn[] {
  const all = Object.values(getTableColumns(spec.table));
  if (spec.columns === undefined) return all;
  return spec.columns.map((name) => columnNamed({ spec, name }));
}

/** The column whose Postgres name is `name`. */
function columnNamed({ spec, name }: { spec: RecordTable; name: string }): PgColumn {
  const column = Object.values(getTableColumns(spec.table)).find((each) => each.name === name);
  if (column === undefined) throw new Error(`${getTableName(spec.table)} has no column ${name}`);
  return column;
}

/** The `where` condition that keeps a table's rows to the Firm's. */
function firmFilter(tx: Database, { spec, firmId }: Omit<WriteTableArgs, "dir">): SQL {
  switch (spec.scope) {
    case "organization":
      return eq(columnNamed({ spec, name: "id" }), firmId);
    case "organization_id":
      return eq(columnNamed({ spec, name: "organization_id" }), firmId);
    case "firm_id":
      return eq(columnNamed({ spec, name: "firm_id" }), firmId);
    case "firm_users": {
      const id = columnNamed({ spec, name: "id" });
      const members = tx
        .select({ id: member.userId })
        .from(member)
        .where(eq(member.organizationId, firmId));
      const inviters = tx
        .select({ id: invitation.inviterId })
        .from(invitation)
        .where(eq(invitation.organizationId, firmId));
      const actors = tx
        .select({ id: auditEvent.actorUserId })
        .from(auditEvent)
        .where(eq(auditEvent.organizationId, firmId));
      const referenced = or(inArray(id, members), inArray(id, inviters), inArray(id, actors));
      if (referenced === undefined) throw new Error("firm_users has no condition");
      return referenced;
    }
    default: {
      const scope: never = spec.scope;
      throw new Error(`Unknown record scope ${String(scope)}`);
    }
  }
}

/** Whether `path` is `root` or inside it, for warning about an export written into the repo. */
export function isInside({ path, root }: { path: string; root: string }): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** The export's README.md: what's in it, how to check it, and what was left out. */
export function recordsReadme(manifest: Manifest): string {
  const { firm } = manifest;
  const state =
    firm.state === "active" ? "active" : `deactivated (since ${firm.deactivatedAt ?? "unknown"})`;
  const files = manifest.files.map((entry) => {
    const spec = RECORD_TABLES.find(({ table }) => getTableName(table) === entry.table);
    return `| \`${entry.file}\` | ${entry.rows} | ${spec?.description ?? ""} |`;
  });
  const excluded = manifest.excluded.map(({ table, reason }) => `- \`${table}\`: ${reason}`);
  return `# Records export: ${firm.name}

A complete copy of the records of ${firm.name} as Cognitive Wealth holds them (Firm
\`${firm.slug}\`, publicId \`${firm.publicId}\`, ${state}), taken at ${manifest.exportedAt}.

## One snapshot

Every file was read in one database transaction (\`repeatable read, read only\`), so they all show
the records as they stood at that moment, and agree with each other.

## Files

| File | Rows | What it holds |
| ---- | ---- | ------------- |
${files.join("\n")}

\`manifest.json\` is the index: for each file, its table, row count, SHA-256 hash, and its columns
with their Postgres types. Times are UTC.

## Reading the CSV files

UTF-8, RFC 4180: a header row of column names, commas between fields, CRLF line endings, and a
field with a comma, a double quote or a line break in double quotes (a quote inside one is doubled).
An empty field is a null; an empty piece of text is \`""\`. A \`jsonb\` column holds JSON text.

Every value is exactly as stored, including text people typed into Cognitive Wealth, so a cell may
begin with \`=\`, \`+\`, \`-\` or \`@\`. A spreadsheet opened by double-clicking a file can read such
a cell as a formula and run it. Import the files instead, with every column set to Text (in Excel,
Data › From Text/CSV), or read them with a database or a CSV library.

## Checking the hashes

Each file's SHA-256 must match \`manifest.json\`'s \`sha256\` for it, for example:

    shasum -a 256 *.csv

The hash of \`manifest.json\` itself is in the Firm's audit trail, in the \`org.records_exported\`
event of this export (\`metadata.manifestHash\`), so the index can be checked too.

## Internal ids

Every column is as stored, internal ids (\`id\` and the \`*_id\` columns) included: they're what
the foreign keys use, so they're what joins one file to another (\`member.user_id\` to \`user.id\`,
\`account_role.account_id\` to \`custodial_account.id\`, …). Cognitive Wealth keeps them away from
browsers, not from the records. \`public_id\` is the id people see in the app.

## Left out

${excluded.join("\n")}
- \`user\`: only \`id\`, \`name\` and \`email\`. The rest of a User's row is their account with
  Cognitive Wealth, not the Firm's record.

## Past members

Removing a member deletes their \`member\` row, and the removal's audit event names only the
membership, so \`user.csv\` finds past members through what they left in the Firm: an invitation
they sent, or an audit event they acted in. Anyone who joined by invitation acted in its
\`org.invitation.accepted\` event, and \`invitation.csv\` keeps their email too. A past member who
did neither, such as a founding owner removed before ever acting in the Firm, isn't listed.

This export holds nonpublic personal information. Keep it encrypted, and hand it over only to
those entitled to it.
`;
}
