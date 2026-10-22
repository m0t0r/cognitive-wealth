// `pnpm org:create`: creates an organization and its owner. Unlike the seed, it runs against any
// database, production included. Node runs this file directly (type stripping), so relative imports
// keep their `.ts` extension, and modules that import the schema load after
// `registerTsResolution()` (see there).
import { parseArgs } from "node:util";
import { connectionConfig } from "../config.ts";
import { connect } from "../connect.ts";
import { describeDatabaseUrl, loadWebEnvFallback } from "./env.ts";
import { registerTsResolution } from "./ts-resolution.ts";

registerTsResolution();
const { CliError, createOrganization } = await import("./organizations.ts");

const USAGE = `Usage: pnpm org:create --name <name> [--slug <slug>] --owner <email>

Creates an organization and makes <email> its owner, creating that user if needed (they set their
name on first sign-in). Prints the organization's publicId and slug.

  --name <name>    The organization's display name.
  --slug <slug>    a-z, 0-9 and hyphens, at most 48 characters. Default: made from --name.
  --owner <email>  The owner's email address (stored lowercase).

Connects with DATABASE_URL (and DATABASE_PASSWORD_FILE, if set). When DATABASE_URL is unset, both
are read from apps/web/.env.local, the pnpm dev database.`;

async function main() {
  // `pnpm org:create -- --name …` passes the separator through; parseArgs would treat the rest
  // as positionals.
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  const { values } = parseArgs({
    args,
    options: {
      name: { type: "string" },
      slug: { type: "string" },
      owner: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  if (values.name === undefined || values.owner === undefined) throw new CliError(USAGE);

  const envFile = loadWebEnvFallback();
  const config = connectionConfig();
  console.log(`Database: ${describeDatabaseUrl(config.url)}${envFile ? ` (from ${envFile})` : ""}`);
  const { db, close } = connect(config, { max: 1 });
  try {
    const org = await createOrganization(db, {
      name: values.name,
      slug: values.slug,
      ownerEmail: values.owner,
    });
    console.log(`Created organization ${org.name}`);
    console.log(`  publicId: ${org.publicId}`);
    console.log(`  slug:     ${org.slug}`);
    console.log(
      `  owner:    ${org.owner.email} (${org.owner.created ? "new user; they set their name on first sign-in" : "existing user"})`,
    );
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
