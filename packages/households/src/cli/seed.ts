// `pnpm db:seed`: adds the dev users and Firms in docs/dev-sign-in.md to a local database, then
// world/v0.json's CRM half to the world's Firm. It lives here, not in `@repo/db`, because
// `@repo/households` depends on `@repo/db`. Node runs this file directly (type stripping), so
// modules written for the bundler load after `registerTsResolution()` (see there).
import { readFileSync } from "node:fs";
import { connectionConfig } from "@repo/db/config";
import { connect } from "@repo/db/connect";
import { describeDatabaseUrl, loadWebEnvFallback } from "@repo/db/cli/env";
import { registerTsResolution } from "@repo/db/cli/ts-resolution";

const WORLD_FILE = new URL("../../../../world/v0.json", import.meta.url);

registerTsResolution();
const { SEED_ORGANIZATIONS, SEED_USERS, assertSeedTarget } = await import("@repo/db/seed-data");
const { SeedConflict, seedDevWorld } = await import("../seed.ts");

async function main() {
  const envFile = loadWebEnvFallback();
  assertSeedTarget(process.env.DATABASE_URL, process.env.NODE_ENV);
  const world: unknown = JSON.parse(readFileSync(WORLD_FILE, "utf8"));
  const config = connectionConfig();
  const { db, close } = connect(config, { max: 1 });
  try {
    const { devData, crm } = await seedDevWorld(db, world);
    const { added } = devData;
    console.log(
      `Seeded ${describeDatabaseUrl(config.url)}${envFile ? ` (from ${envFile})` : ""}: added ` +
        `${added.users} users, ${added.organizations} organizations and ${added.memberships} ` +
        `memberships, and from world/v0.json ${crm.added.households} Households, ` +
        `${crm.added.people} People, ${crm.added.accounts} Accounts and ` +
        `${crm.added.accountRoles} Account roles; existing rows were left as they are.`,
    );
    if (devData.renamed.organizations > 0) {
      console.log("  Renamed the old Acme to Larkspur Wealth Partners, keeping its members.");
    }
  } finally {
    await close();
  }

  for (const org of SEED_ORGANIZATIONS) {
    const members = SEED_USERS.flatMap(({ email, roles }) =>
      roles[org.slug] ? [`${email} (${roles[org.slug]})`] : [],
    );
    console.log(`  ${org.name} (${org.slug}): ${members.join(", ")}`);
  }
  console.log(`Sign in with: pnpm dev:sign-in ${SEED_USERS[0]!.email}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (error instanceof SeedConflict) {
    console.error(
      "world/v0.json changed since this database was seeded, and a row seeded from the old " +
        "file now differs (in the new file, or edited in the app); the seed never overwrites. " +
        "Nothing was written. To load the new world, start the database over " +
        "(docs/dev-sign-in.md: `down -v`), migrate and seed again.",
    );
  }
  process.exitCode = 1;
}
