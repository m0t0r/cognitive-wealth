// `pnpm db:seed`: adds the dev users and organizations in docs/dev-sign-in.md to a local database.
// Node runs this file directly (type stripping), so relative imports keep their `.ts` extension,
// and modules that import the schema load after `registerTsResolution()` (see there).
import { connectionConfig } from "./config.ts";
import { connect } from "./connect.ts";
import { describeDatabaseUrl, loadWebEnvFallback } from "./cli/env.ts";
import { registerTsResolution } from "./cli/ts-resolution.ts";

registerTsResolution();
const { SEED_ORGANIZATIONS, SEED_USERS, assertSeedTarget, seedDevData } =
  await import("./cli/seed-data.ts");

async function main() {
  const envFile = loadWebEnvFallback();
  assertSeedTarget(process.env.DATABASE_URL, process.env.NODE_ENV);
  const config = connectionConfig();
  const { db, close } = connect(config, { max: 1 });
  try {
    const { added } = await seedDevData(db);
    console.log(
      `Seeded ${describeDatabaseUrl(config.url)}${envFile ? ` (from ${envFile})` : ""}: added ` +
        `${added.users} users, ${added.organizations} organizations and ${added.memberships} ` +
        "memberships; existing rows were left as they are.",
    );
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
  process.exitCode = 1;
}
