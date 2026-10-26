// A Records export of one Firm (GLOSSARY.md, #206), as `pnpm org:export` writes it: one CSV per
// table in `RECORD_TABLES`, `manifest.json` (the index) and `README.md`, read as `migrator` in one
// snapshot and audited as `org.records_exported`. Rule 204-2(g)(2) asks for records arranged for
// "easy location, access, and retrieval" and a "true and complete copy", and names no format, so
// it's CSV, which any spreadsheet or database opens. It queries through postgres.js rather than
// Drizzle's builders (packages/db/CLAUDE.md), because it streams through a cursor, casts every
// column to text and names its tables from `RECORD_TABLES`. Imports `organizations.ts`, so a Node
// entry loads this after `registerTsResolution()`.
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { finished } from "node:stream/promises";
import { parseArgs } from "node:util";
import type postgres from "postgres";
import { EXCLUDED_TABLES, RECORD_TABLES, type RecordTable } from "../records.ts";
import { csvRow } from "./csv.ts";
import { CliError, normalizeSlug, parseReason } from "./organizations.ts";

/** Bumped when a file's layout changes, so a reader can tell which one it has. */
export const MANIFEST_VERSION = 1;

/** The role a Records export reads as: the tables' owner, which row-level security doesn't hold. */
const EXPORT_ROLE = "migrator";

/** Rows fetched per round trip. Rows are written as they come, so no table is held in memory. */
const CURSOR_ROWS = 1000;

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

/** What `exportRecords` wrote, for the CLI's summary. */
export type RecordsExport = {
  out: string;
  firm: { slug: string; publicId: string; name: string };
  firmState: FirmState;
  exportedAt: Date;
  tables: { table: string; file: string; rows: number }[];
  manifestHash: string;
};

type ExportArgs = { slug: string; out: string; reason: string };

/**
 * Writes the Firm `slug`'s Records export to `out`, active or deactivated. Every table is read in
 * one `repeatable read, read only` transaction as `migrator`, so the files are one snapshot and
 * Postgres refuses any write. The files go into a temporary folder beside `out` (mode 0700, files
 * 0600), the `org.records_exported` audit event is written, and only then is the folder moved to
 * `out`; a failure up to the audit write, that one included, removes the temporary folder and
 * throws. A failed move after it keeps the folder and names it. Throws `CliError`, writing nothing,
 * for an unknown slug, a non-empty `out` or another role.
 */
export async function exportRecords(
  client: postgres.Sql,
  input: ExportArgs,
): Promise<RecordsExport> {
  const slug = normalizeSlug(input.slug);
  const reason = parseReason(input.reason);
  const out = resolve(input.out);
  await assertEmptyOrMissing(out);
  await mkdir(dirname(out), { recursive: true });
  // Beside `out`, so the final move is a rename on the same file system. mkdtemp makes it 0700.
  const temp = await mkdtemp(join(dirname(out), `.${basename(out)}.partial-`));
  let exported: RecordsExport;
  try {
    const snapshot = await client.begin("isolation level repeatable read read only", (tx) =>
      readSnapshot(tx, { slug, dir: temp }),
    );
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
      excluded: EXCLUDED_TABLES.map(({ table, reason: why }) => ({ table, reason: why })),
    };
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(join(temp, "manifest.json"), manifestText, { mode: 0o600, flag: "wx" });
    await writeFile(join(temp, "README.md"), recordsReadme(manifest), { mode: 0o600, flag: "wx" });
    const manifestHash = sha256(manifestText);
    const tables = Object.fromEntries(snapshot.files.map(({ table, rows }) => [table, rows]));

    // Inserted directly, so a failure throws (writeAuditEvent would swallow it): an export that
    // isn't in the audit trail isn't handed over. The metadata goes as JSON text: Drizzle replaces
    // postgres.js's JSON serializer on a client it wraps, so `client.json()` isn't reliable here.
    const metadata = JSON.stringify({ via: "cli", reason, firmState, tables, manifestHash });
    try {
      await client`
        insert into audit_event (action, actor_user_id, organization_id, target_type, target_id, metadata)
        values (
          'org.records_exported', null, ${firm.id}, 'organization', ${firm.publicId},
          ${metadata}::jsonb
        )
      `;
    } catch (error) {
      throw new Error(
        `Couldn't record the export in the audit trail, so nothing was written: ` +
          `${error instanceof Error ? error.message : String(error)}. Fix that, then run it again.`,
        { cause: error },
      );
    }
    exported = {
      out,
      firm: { slug, publicId: firm.publicId, name: firm.name },
      firmState,
      exportedAt: new Date(snapshot.exportedAt),
      tables: snapshot.files.map(({ table, file, rows }) => ({ table, file, rows })),
      manifestHash,
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

/** Refuses an `out` that exists and isn't an empty folder: an export never mixes with other files. */
async function assertEmptyOrMissing(out: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(out);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return;
    if (code === "ENOTDIR") {
      throw new CliError(
        `${out} exists and isn't a folder. Pick a new folder with --out; nothing was written.`,
      );
    }
    throw error;
  }
  if (entries.length > 0) {
    throw new CliError(`${out} isn't empty. Pick a new folder with --out; nothing was written.`);
  }
}

type SnapshotFirm = { id: number; publicId: string; name: string; deactivatedAt: string | null };

type Snapshot = { firm: SnapshotFirm; exportedAt: string; files: ManifestFile[] };

type ReadSnapshotArgs = { slug: string; dir: string };

async function readSnapshot(
  tx: postgres.TransactionSql,
  { slug, dir }: ReadSnapshotArgs,
): Promise<Snapshot> {
  // Timestamps in UTC, whatever the server's default, so the files read the same anywhere.
  await tx`set local timezone = 'UTC'`;
  const [role] = await tx<{ name: string }[]>`select current_user as name`;
  if (role?.name !== EXPORT_ROLE) {
    throw new CliError(
      `Connected as ${role?.name ?? "an unknown role"}, but a Records export reads as ` +
        `${EXPORT_ROLE}, whom row-level security doesn't hold. Point DATABASE_URL and ` +
        `DATABASE_PASSWORD_FILE at ${EXPORT_ROLE}.`,
    );
  }
  const [row] = await tx<
    { id: string; publicId: string; name: string; deactivatedAt: string | null; now: string }[]
  >`
    select id::text, public_id::text as "publicId", name,
      to_json(deactivated_at) #>> '{}' as "deactivatedAt", to_json(now()) #>> '{}' as now
    from organization where slug = ${slug}
  `;
  if (row === undefined) {
    throw new CliError(
      `No organization has the slug "${slug}". Check the slug (organization.slug); nothing was written.`,
    );
  }
  const firm = {
    id: Number(row.id),
    publicId: row.publicId,
    name: row.name,
    deactivatedAt: row.deactivatedAt,
  };
  const files: ManifestFile[] = [];
  for (const spec of RECORD_TABLES) {
    // One at a time: a transaction is one connection, which runs one query at a time.
    // oxlint-disable-next-line no-await-in-loop
    files.push(await writeTable(tx, { spec, firmId: firm.id, dir }));
  }
  return { firm, exportedAt: row.now, files };
}

type WriteTableArgs = { spec: RecordTable; firmId: number; dir: string };

/** Streams one table's rows for the Firm into `<table>.csv`, hashing as it writes. */
async function writeTable(
  tx: postgres.TransactionSql,
  { spec, firmId, dir }: WriteTableArgs,
): Promise<ManifestFile> {
  const columns = await tableColumns(tx, spec);
  const file = `${spec.table}.csv`;
  const stream = createWriteStream(join(dir, file), { mode: 0o600, flags: "wx" });
  const hash = createHash("sha256");
  const write = async (chunk: string) => {
    hash.update(chunk);
    if (!stream.write(chunk)) await once(stream, "drain");
  };
  let rows = 0;
  try {
    await write(csvRow(columns.map(({ name }) => name)));
    // Every value as Postgres's own text form, so nothing is reshaped on the way: `numeric` keeps
    // its digits, `timestamptz` its microseconds, `jsonb` is JSON text.
    const select = columns
      .map(({ name }) => tx`${tx(name)}::text as ${tx(name)}`)
      .reduce((list, column) => tx`${list}, ${column}`);
    const query = tx<Record<string, string | null>[]>`
      select ${select} from ${tx(spec.table)} where ${firmFilter(tx, { spec, firmId })} order by id
    `;
    for await (const batch of query.cursor(CURSOR_ROWS)) {
      // Waiting for the file to drain before the next batch is what keeps memory flat.
      await write(
        batch.map((values) => csvRow(columns.map(({ name }) => values[name] ?? null))).join(""),
      );
      rows += batch.length;
    }
  } finally {
    stream.end();
    await finished(stream);
  }
  return { file, table: spec.table, rows, sha256: hash.digest("hex"), columns };
}

/** The table's columns as Postgres declares them, narrowed to `spec.columns` when it names some. */
async function tableColumns(tx: postgres.TransactionSql, spec: RecordTable): Promise<Column[]> {
  const all = await tx<Column[]>`
    select attname as name, format_type(atttypid, atttypmod) as type
    from pg_attribute
    where attrelid = to_regclass(quote_ident(${spec.table})) and attnum > 0 and not attisdropped
    order by attnum
  `;
  if (all.length === 0) throw new Error(`Table ${spec.table} doesn't exist`);
  if (spec.columns === undefined) return [...all];
  return spec.columns.map((name) => {
    const column = all.find((candidate) => candidate.name === name);
    if (column === undefined) throw new Error(`Table ${spec.table} has no column ${name}`);
    return column;
  });
}

/** The `where` condition that keeps a table's rows to the Firm's. */
function firmFilter(tx: postgres.TransactionSql, { spec, firmId }: Omit<WriteTableArgs, "dir">) {
  switch (spec.scope) {
    case "organization":
      return tx`id = ${firmId}`;
    case "organization_id":
      return tx`organization_id = ${firmId}`;
    case "firm_id":
      return tx`firm_id = ${firmId}`;
    case "firm_users":
      return tx`id in (
        select user_id from member where organization_id = ${firmId}
        union select inviter_id from invitation where organization_id = ${firmId}
        union select actor_user_id from audit_event where organization_id = ${firmId}
      )`;
    default: {
      const scope: never = spec.scope;
      throw new Error(`Unknown record scope ${String(scope)}`);
    }
  }
}

/**
 * `pnpm org:export`'s arguments, `--slug <slug> --out <dir> --reason <text>`: `{ help: true }` for
 * `--help`, otherwise all three, checked (a `CliError` with `usage` when one is missing).
 */
export function parseExportArgs({
  args,
  usage,
}: {
  args: string[];
  usage: string;
}): { help: true } | ({ help: false } & ExportArgs) {
  // `pnpm org:export -- --slug …` passes the separator through.
  const rest = args[0] === "--" ? args.slice(1) : args;
  let values;
  try {
    ({ values } = parseArgs({
      args: rest,
      options: {
        slug: { type: "string" },
        out: { type: "string" },
        reason: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
    }));
  } catch (error) {
    throw new CliError(`${error instanceof Error ? error.message : String(error)}\n\n${usage}`);
  }
  if (values.help) return { help: true };
  const { slug, out, reason } = values;
  if (slug === undefined || out === undefined || reason === undefined) {
    const missing = Object.entries({ slug, out, reason })
      .filter(([, value]) => value === undefined)
      .map(([name]) => `--${name}`);
    throw new CliError(`Missing ${missing.join(", ")}.\n\n${usage}`);
  }
  return { help: false, slug: normalizeSlug(slug), out, reason: parseReason(reason) };
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
    const spec = RECORD_TABLES.find(({ table }) => table === entry.table);
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
