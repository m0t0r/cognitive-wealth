// `node packages/db/src/cli/run-seed.ts <file>[:<export>]`: runs one seed function, such as an e2e
// helper (`apps/web-e2e/support/households.ts:seedHouseholdOfGrace`), against DATABASE_URL, so
// `cw verify start --seed` can add a change's own data to its verify database (#164)
// without a second copy of it in SQL. Node runs this file directly (type stripping), and the seed
// module, written for the bundler, loads after `registerTsResolution()` (see there).
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { connectionConfig } from "../config.ts";
import { connect } from "../connect.ts";
import { describeDatabaseUrl, loadWebEnvFallback } from "./env.ts";
import { registerTsResolution } from "./ts-resolution.ts";

registerTsResolution();
const { assertSeedTarget } = await import("./seed-data.ts");

const USAGE = `Usage: node packages/db/src/cli/run-seed.ts <file>[:<export>]

Imports <file> (relative to the working directory) and calls its <export> (default: the default
export) with a Drizzle database, as the e2e seed helpers take it: (db: Database) => Promise<unknown>.
Prints what it returns, if anything. Local databases only, like pnpm db:seed.

Connects with DATABASE_URL (and DATABASE_PASSWORD_FILE, if set). When DATABASE_URL is unset, both
are read from apps/web/.env.local, the pnpm dev database, except in a git worktree.`;

async function main() {
  const [target] = process.argv.slice(2);
  if (!target || target === "--help" || target === "-h") {
    console.error(USAGE);
    process.exitCode = target ? 0 : 2;
    return;
  }
  const colon = target.lastIndexOf(":");
  const [file, name] =
    colon > 0 ? [target.slice(0, colon), target.slice(colon + 1)] : [target, "default"];

  const envFile = loadWebEnvFallback();
  assertSeedTarget(process.env.DATABASE_URL, process.env.NODE_ENV);
  const module: Record<string, unknown> = await import(pathToFileURL(resolve(file)).href);
  const seed = module[name];
  if (typeof seed !== "function") throw new Error(`${file} has no function export "${name}"`);

  const config = connectionConfig();
  const { db, close } = connect(config, { max: 1 });
  try {
    const result: unknown = await seed(db);
    console.log(
      `Ran ${name} from ${file} on ${describeDatabaseUrl(config.url)}` +
        `${envFile ? ` (from ${envFile})` : ""}${result === undefined ? "" : `: ${JSON.stringify(result)}`}`,
    );
  } finally {
    await close();
  }
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
