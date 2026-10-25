// `pnpm custodian:ingest <date>`: Ingestion of one As-of date's Delivery from the Custodian feed
// into a Firm (by default the world file's, Larkspur), from the local folder the custodian's
// `feed:write` writes. Node runs this file directly (type stripping), so modules written for the
// bundler load after `registerTsResolution()` (see there).
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { describeDatabaseUrl, loadWebEnvFallback } from "@repo/db/cli/env";
import { registerTsResolution } from "@repo/db/cli/ts-resolution";
import { connectionConfig } from "@repo/db/config";
import { connect } from "@repo/db/connect";

// Where `pnpm --filter custodian feed:write` writes, in the same checkout (ADR 0017).
const DEFAULT_ROOT = join(import.meta.dirname, "../../../../.dev/custodian-feed");
const USAGE = "Usage: pnpm custodian:ingest <YYYY-MM-DD> [--firm <slug>] [--root <dir>]";

registerTsResolution();
const { organization } = await import("@repo/db/schema");
const { WORLD_FIRM_SLUG } = await import("@repo/db/seed-data");
const { eq } = await import("drizzle-orm");
const { localFeedSource } = await import("../feed-source.ts");
const { ingestDelivery } = await import("../ingest.ts");

async function main() {
  // pnpm passes a `--` through when the script is run as `pnpm custodian:ingest -- <date>`.
  const args = process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === "--"));
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      firm: { type: "string", default: WORLD_FIRM_SLUG },
      root: { type: "string", default: DEFAULT_ROOT },
    },
  });
  const [asOf, ...extra] = positionals;
  if (!asOf || extra.length > 0 || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    throw new Error(USAGE);
  }
  // pnpm runs the script in this package; a relative --root means where the command was typed.
  // pnpm sets INIT_CWD; this script isn't a Turborepo task, so turbo.json needn't list it.
  // oxlint-disable-next-line turbo/no-undeclared-env-vars
  const root = resolve(process.env.INIT_CWD ?? process.cwd(), values.root);

  const envFile = loadWebEnvFallback();
  const config = connectionConfig();
  const { db, close } = connect(config, { max: 1 });
  try {
    const [firm] = await db
      .select({ id: organization.id, name: organization.name })
      .from(organization)
      .where(eq(organization.slug, values.firm));
    if (!firm) throw new Error(`No Firm has the slug '${values.firm}'`);

    const result = await ingestDelivery(db, {
      firmId: firm.id,
      asOf,
      source: localFeedSource(root),
    });
    const target = `${firm.name} in ${describeDatabaseUrl(config.url)}${envFile ? ` (from ${envFile})` : ""}`;
    switch (result.status) {
      case "ingested": {
        const { written } = result;
        console.log(
          `Ingested the Delivery for ${asOf} from ${join(root, asOf)} into ${target}: ` +
            `${count(written.transactions, "Transaction")}, ` +
            `${count(written.positions, "Position")} and ${count(written.prices, "price")}, and ` +
            `${count(written.securities, "Security", "Securities")} and ` +
            `${count(written.accounts, "Account")} added or updated. ` +
            `Manifest ${result.manifestSha256}.`,
        );
        break;
      }
      case "already_ingested":
        console.log(
          `The Delivery for ${asOf} (Manifest ${result.manifestSha256}) was already ingested ` +
            `into ${target}; nothing was written.`,
        );
        break;
      case "refused":
        console.error(`Refused the Delivery for ${asOf}; nothing was written. ${result.message}.`);
        if (result.reason === "not_delivered" || result.reason === "incomplete") {
          console.error(
            `If the custodian is still writing it, try again once it's done ` +
              `(pnpm --filter custodian feed:write --date ${asOf} writes it to ${root}).`,
          );
        }
        process.exitCode = 1;
        break;
    }
  } finally {
    await close();
  }
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
