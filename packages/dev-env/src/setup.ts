// Prepares a worktree's dev environment: its own database on the verification Postgres (the first
// time created, migrated, seeded and given the custodian's example Deliveries, as a verification
// database is, #223; migrated after that), and an `apps/web/.env.local` that points at it, its
// Redis prefix and the shared verification Mailpit. Node runs the CLIs that import this directly
// (type stripping), so relative imports keep their `.ts` extension.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Checkout } from "./checkout.ts";
import { VERIFY_PORTS, worktreeEnvFile } from "./env-file.ts";
import { worktreeResources } from "./names.ts";
import { type DomainCalls, type Populated, populate } from "./populate.ts";
import { type RunResult, checked, runCommand } from "./processes.ts";
import { type WorktreeRecord, readRecord, writeRecord } from "./registry.ts";
import {
  assertSecrets,
  createDatabase,
  dropDatabase,
  secretsDir,
  startServices,
} from "./services.ts";

type ExecArgs = { command: string; args: string[]; cwd: string; env: Record<string, string> };

/** What setting a worktree up reaches outside itself for; a test hands in its own. */
export type SetupSystem = {
  assertSecrets: typeof assertSecrets;
  startServices: typeof startServices;
  createDatabase: typeof createDatabase;
  dropDatabase: typeof dropDatabase;
  /** Runs a command to its end, captured. */
  exec: (args: ExecArgs) => RunResult;
  populate: typeof populate;
};

export const defaultSetupSystem: SetupSystem = {
  assertSecrets,
  startServices,
  createDatabase,
  dropDatabase,
  exec: runCommand,
  populate,
};

type SetUpWorktreeArgs = Checkout & {
  worktreeId: string;
  /** The seed and Ingestion as direct calls (`cw`'s own); without them, `pnpm cw … --json` runs. */
  domain?: DomainCalls | undefined;
  system?: SetupSystem;
};

/**
 * Sets up the worktree `checkout` and returns its record. The record is written first, so a crash
 * part-way still leaves teardown and prune something to find.
 */
export async function setUpWorktree({
  system = defaultSetupSystem,
  domain,
  ...checkout
}: SetUpWorktreeArgs) {
  const { top, mainCheckout, worktreeId } = checkout;
  system.assertSecrets(mainCheckout);
  const resources = worktreeResources(worktreeId);
  const record: WorktreeRecord = {
    ...readRecord({ mainCheckout, token: resources.token }),
    ...resources,
    id: worktreeId,
    path: top,
  };
  writeRecord({ mainCheckout, record });

  system.startServices({ mainCheckout, top });
  const { database } = resources;
  const secrets = secretsDir(mainCheckout);
  const url = (role: string) => `postgres://${role}@localhost:${VERIFY_PORTS.postgres}/${database}`;
  const created = await system.createDatabase({ mainCheckout, database });
  let ingested: Populated["ingested"] = [];
  try {
    // Only a new database is seeded and given the example Deliveries: a reseed after
    // world/v0.json changed would refuse (SeedConflict), and the rows this worktree added since
    // are its own.
    if (created) {
      ({ ingested } = await system.populate({ checkout: top, url, secrets, domain }));
    } else {
      checked({
        result: system.exec({
          command: "pnpm",
          args: ["--silent", "--filter", "@repo/db", "db:migrate"],
          cwd: top,
          env: {
            DATABASE_URL: url("migrator"),
            DATABASE_PASSWORD_FILE: join(secrets, "db_migrator_password"),
          },
        }),
        code: "migrate_failed",
        what: `Migrating ${url("migrator")}`,
      });
    }
  } catch (error) {
    // A half-set-up database would never be seeded again (the next run finds it exists).
    if (created) await system.dropDatabase({ mainCheckout, database });
    throw error;
  }

  writeFileSync(
    join(top, "apps/web/.env.local"),
    worktreeEnvFile({ secretsDir: secrets, database, redisPrefix: resources.redisPrefix }),
  );
  return { record, created, ingested };
}
