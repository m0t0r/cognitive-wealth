// `pnpm dev:env`: sets up this worktree's dev environment (its database and `apps/web/.env.local`)
// without starting the app, e.g. before `pnpm db:studio` or `pnpm custodian:ingest` here. `pnpm dev`
// does the same on every start. Node runs this file directly (type stripping), so relative imports
// keep their `.ts` extension.
import { checkoutAt } from "../checkout.ts";
import { sweep } from "../prune.ts";
import { setUpWorktree } from "../setup.ts";

const checkout = checkoutAt(process.cwd());
const { worktreeId } = checkout;

if (!worktreeId) {
  console.log(
    "This is the main checkout: it uses the dev stack (apps/web/.env.example), not this.",
  );
} else {
  await sweep(checkout.mainCheckout);
  try {
    const { record, created } = await setUpWorktree({ ...checkout, worktreeId });
    console.log(
      `${created ? "Created, migrated and seeded" : "Migrated"} ${record.database} on the ` +
        `verification Postgres (:5433); Redis keys go under ${record.redisPrefix}, mail to the ` +
        "shared verification Mailpit (http://127.0.0.1:8026). Wrote apps/web/.env.local.",
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
