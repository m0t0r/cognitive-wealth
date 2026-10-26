// `pnpm org:export` (#206): the operator's way to produce a Firm's records, a Records export
// (GLOSSARY.md). Like `org:create`, it runs against any database, production included. It reads
// as `migrator`, whom row-level security doesn't hold: on a local database it signs in as
// `migrator` the way `db:studio` does (`studio-connection.ts`), and anywhere else DATABASE_URL must
// name it. Node runs this file directly (type stripping), so relative imports keep their `.ts`
// extension, and modules that import the schema load after `registerTsResolution()`.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connect } from "../connect.ts";
import { describeDatabaseUrl, loadWebEnvFallback } from "./env.ts";
import { registerTsResolution } from "./ts-resolution.ts";

registerTsResolution();
const { exportRecords, isInside, parseExportArgs } = await import("./records-export.ts");
const { studioConnection } = await import("./studio-connection.ts");
const { CliError } = await import("./organizations.ts");

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");

const USAGE = `Usage: pnpm org:export --slug <slug> --out <dir> --reason <text>

Writes a Records export of the organization: every record table as CSV, manifest.json (the index:
row counts, SHA-256 hashes, columns) and README.md, read in one snapshot, active or deactivated.
The export is audited as org.records_exported. It holds nonpublic personal information: encrypting
and delivering it are up to you.

  --slug <slug>    The organization's slug.
  --out <dir>      A new or empty folder to write into (made 0700, its files 0600).
  --reason <text>  Who asked and why, for the audit log ("SEC exam request of …").

Connects with DATABASE_URL (and DATABASE_PASSWORD_FILE, if set), as migrator: on a local database
it signs in as migrator itself; anywhere else, DATABASE_URL must name migrator. When DATABASE_URL
is unset, both are read from apps/web/.env.local, the pnpm dev database, except in a git worktree.`;

async function main() {
  const parsed = parseExportArgs({ args: process.argv.slice(2), usage: USAGE });
  if (parsed.help) {
    console.log(USAGE);
    return;
  }
  const out = resolve(parsed.out);
  if (isInside({ path: out, root: REPO_ROOT })) {
    console.warn(
      `Warning: ${out} is inside the repository. The export holds clients' personal information; ` +
        "keep it out of the repository and anything that syncs it.",
    );
  }

  const envFile = loadWebEnvFallback();
  if (!process.env.DATABASE_URL) throw new CliError("DATABASE_URL is not set.");
  const connection = studioConnection(process.env);
  const { passwordFile } = connection;
  const from = envFile ? ` (from ${envFile})` : "";
  console.log(`Database: ${describeDatabaseUrl(connection.url)} as ${connection.role}${from}`);
  const { client, close } = connect(
    {
      url: connection.url,
      password: passwordFile ? () => readFileSync(passwordFile, "utf8").trim() : undefined,
    },
    { max: 1 },
  );
  try {
    const result = await exportRecords(client, {
      slug: parsed.slug,
      out,
      reason: parsed.reason,
    });
    console.log(`Exported the records of ${result.firm.name} (${result.firmState})`);
    console.log(`  publicId: ${result.firm.publicId}`);
    console.log(`  to:       ${result.out}`);
    console.log(`  snapshot: ${result.exportedAt.toISOString()}`);
    console.log(`  manifest: sha256 ${result.manifestHash}`);
    const width = Math.max(...result.tables.map(({ file }) => file.length));
    for (const { file, rows } of result.tables) {
      console.log(`    ${file.padEnd(width)}  ${rows} row(s)`);
    }
  } finally {
    await close();
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
