// Prepares a worktree's dev environment: its own database on the verification Postgres (created,
// migrated and seeded the first time, migrated after that), and an `apps/web/.env.local` that
// points at it, its Redis prefix and the shared verification Mailpit. Node runs the CLIs that
// import this directly (type stripping), so relative imports keep their `.ts` extension.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Checkout } from "./checkout.ts";
import { VERIFY_PORTS, worktreeEnvFile } from "./env-file.ts";
import { worktreeResources } from "./names.ts";
import { type WorktreeRecord, readRecord, writeRecord } from "./registry.ts";
import {
  assertSecrets,
  createDatabase,
  dropDatabase,
  secretsDir,
  startServices,
} from "./services.ts";

type RunArgs = { top: string; script: string[]; env: Record<string, string> };

/** Runs a repo script (`pnpm …`) in `top` with `env` on top of this process's environment. */
function run({ top, script, env }: RunArgs) {
  execFileSync("pnpm", ["--silent", ...script], {
    cwd: top,
    env: { ...process.env, ...env },
    // Captured, and shown only when the step fails (execFileSync puts it on the error).
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Sets up the worktree `checkout` and returns its record. The record is written first, so a crash
 * part-way still leaves teardown and prune something to find.
 */
export async function setUpWorktree(checkout: Checkout & { worktreeId: string }) {
  const { top, mainCheckout, worktreeId } = checkout;
  assertSecrets(mainCheckout);
  const resources = worktreeResources(worktreeId);
  const record: WorktreeRecord = {
    ...readRecord({ mainCheckout, token: resources.token }),
    ...resources,
    id: worktreeId,
    path: top,
  };
  writeRecord({ mainCheckout, record });

  startServices({ mainCheckout, top });
  const { database } = resources;
  const secrets = secretsDir(mainCheckout);
  const url = (role: string) => `postgres://${role}@localhost:${VERIFY_PORTS.postgres}/${database}`;
  const created = await createDatabase({ mainCheckout, database });
  try {
    run({
      top,
      script: ["--filter", "@repo/db", "db:migrate"],
      env: {
        DATABASE_URL: url("migrator"),
        DATABASE_PASSWORD_FILE: join(secrets, "db_migrator_password"),
      },
    });
    // Only a new database: a reseed after world/v0.json changed would refuse (SeedConflict), and
    // the rows this worktree added since are its own.
    if (created) {
      run({
        top,
        script: ["db:seed"],
        env: { DATABASE_URL: url("app"), DATABASE_PASSWORD_FILE: join(secrets, "db_app_password") },
      });
    }
  } catch (error) {
    // A half-set-up database would never be seeded again (the next run finds it exists).
    if (created) await dropDatabase({ mainCheckout, database });
    throw error;
  }

  writeFileSync(
    join(top, "apps/web/.env.local"),
    worktreeEnvFile({ secretsDir: secrets, database, redisPrefix: resources.redisPrefix }),
  );
  return { record, created };
}
