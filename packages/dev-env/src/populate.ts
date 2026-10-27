// Gives a verification database the data every verifier-web run starts from: the checkout's own
// migrations, the seed (the dev users and Firms, the world's CRM half) and the custodian's example
// Deliveries ingested into Larkspur (#147). `cw verify start` and `cw verify compose up` both run
// it. In this checkout the seed and Ingestion are `cw`'s own calls (`DomainCalls`, handed in by
// `@repo/cli`, which this package can't import); a `--ref` checkout runs its own `cw … --json`
// instead, since its schema is the ref's and only its own code fits it. Node runs the CLIs that
// import this directly (type stripping), so relative imports keep their `.ts` extension.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CliError } from "@repo/db/cli/cli-error";

export type RunArgs = { cwd: string; args: string[]; env: Record<string, string> };
export type RunResult = { status: number | null; stdout: string; stderr: string };

/** `pnpm <args>` in `cwd`, with `env` on top of this process's environment, captured. */
export function runPnpm({ cwd, args, env }: RunArgs): RunResult {
  const { status, stdout, stderr } = spawnSync("pnpm", args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status, stdout, stderr };
}

/** The end of a failed step's output, enough to see why without flooding the error. */
export const tail = (text: string) => text.trim().split("\n").slice(-20).join("\n");

export type Populated = {
  /** Rows the seed added; undefined for a checkout from before `cw`, whose seed prints none. */
  seeded: { users: number; households: number } | undefined;
  ingested: Array<{ asOf: string; status: "ingested" | "already_ingested" }>;
  /** What this checkout couldn't do, for a `--ref` from before `cw` or Ingestion. */
  notes: string[];
};

/** A database to write to, as `app`. */
export type DatabaseTarget = { url: string; passwordFile: string };

/** `cw db seed` and `cw custodian ingest`, each a call that throws a `CliError` on refusal. */
export type DomainCalls = {
  seed: (target: DatabaseTarget) => Promise<{ users: number; households: number }>;
  ingest: (args: {
    target: DatabaseTarget;
    asOf: string;
    root: string;
  }) => Promise<"ingested" | "already_ingested">;
};

/** What `cw db seed --json` says it added, or a refusal when it printed something else. */
function addedBy(output: Record<string, unknown>) {
  const { added } = output;
  if (
    typeof added === "object" &&
    added !== null &&
    "users" in added &&
    "households" in added &&
    typeof added.users === "number" &&
    typeof added.households === "number"
  ) {
    return { users: added.users, households: added.households };
  }
  throw new CliError({ code: "populate_failed", message: "cw db seed printed no counts." });
}

/** The status `cw custodian ingest --json` reports, or a refusal when it printed another. */
function statusOf(output: Record<string, unknown>) {
  const { status } = output;
  if (status === "ingested" || status === "already_ingested") return status;
  throw new CliError({
    code: "populate_failed",
    message: `cw custodian ingest printed the status ${String(status)}.`,
  });
}

type SubprocessCallsArgs = {
  checkout: string;
  run: (args: RunArgs) => RunResult;
  env: Record<string, string>;
};

/**
 * The checkout's own `cw … --json`, as calls. One is missing when the checkout predates it (`cw`
 * came on 2026-10-26, and `cw custodian ingest` with it).
 */
function subprocessCalls({ checkout, run, env }: SubprocessCallsArgs): Partial<DomainCalls> {
  /** `cw <args> --json` in the checkout: its output, or its own error code on failure. */
  const cw = (args: string[]): Record<string, unknown> => {
    const { status, stdout, stderr } = run({
      cwd: checkout,
      args: ["--silent", "cw", ...args, "--json"],
      env,
    });
    let parsed: Record<string, unknown> | undefined;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      parsed = undefined;
    }
    if (status === 0 && parsed) return parsed;
    const label = `cw ${args.slice(0, 2).join(" ")}`;
    throw new CliError({
      code: typeof parsed?.code === "string" ? parsed.code : "populate_failed",
      message: `${label}: ${typeof parsed?.message === "string" ? parsed.message : tail(stderr || stdout)}`,
    });
  };
  const commands = join(checkout, "packages/cli/src/commands");
  return {
    ...(existsSync(join(commands, "db.ts")) && {
      seed: async () => addedBy(cw(["db", "seed"])),
    }),
    ...(existsSync(join(commands, "custodian.ts")) && {
      ingest: async ({ asOf, root }) => statusOf(cw(["custodian", "ingest", asOf, "--root", root])),
    }),
  };
}

type PopulateArgs = {
  /** The checkout whose code runs: the served one (a `--ref` checkout, or this one). */
  checkout: string;
  /** The database's URL as `role`, without a password. */
  url: (role: "app" | "migrator") => string;
  /** The directory holding `db_app_password` and `db_migrator_password`. */
  secrets: string;
  run?: (args: RunArgs) => RunResult;
  /**
   * The seed and Ingestion as direct calls, for this checkout (whose code `cw` runs); without
   * them, the checkout's own `cw … --json` runs.
   */
  domain?: DomainCalls | undefined;
};

export async function populate({
  checkout,
  url,
  secrets,
  run = runPnpm,
  domain,
}: PopulateArgs): Promise<Populated> {
  const as = (role: "app" | "migrator") => ({
    DATABASE_URL: url(role),
    DATABASE_PASSWORD_FILE: join(secrets, `db_${role}_password`),
  });
  const notes: string[] = [];

  const migrated = run({
    cwd: checkout,
    args: ["--silent", "--filter", "@repo/db", "db:migrate"],
    env: as("migrator"),
  });
  if (migrated.status !== 0) {
    throw new CliError({
      code: "migrate_failed",
      message: `Migrating ${url("migrator")} failed:\n${tail(migrated.stderr || migrated.stdout)}`,
    });
  }

  const app = { url: url("app"), passwordFile: join(secrets, "db_app_password") };
  const calls = domain ?? subprocessCalls({ checkout, run, env: as("app") });

  let seeded: Populated["seeded"];
  if (calls.seed) {
    seeded = await calls.seed(app);
  } else {
    // A checkout from before `cw` has only the seed's script.
    const legacy = run({ cwd: checkout, args: ["--silent", "db:seed"], env: as("app") });
    if (legacy.status !== 0) {
      throw new CliError({
        code: "seed_failed",
        message: `pnpm db:seed failed:\n${tail(legacy.stderr || legacy.stdout)}`,
      });
    }
    notes.push("seeded with this checkout's pnpm db:seed, which predates cw");
  }

  const feed = join(checkout, "apps/custodian/fixtures/feed");
  const ingested: Populated["ingested"] = [];
  if (!calls.ingest || !existsSync(feed)) {
    notes.push("no Delivery ingested: this checkout has no cw custodian ingest");
  } else {
    const deliveries = readdirSync(feed).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name));
    for (const asOf of deliveries.toSorted()) {
      // A Delivery ingested on an earlier run succeeds as `already_ingested`.
      // oxlint-disable-next-line no-await-in-loop -- in As-of order, as the custodian delivered them
      const status = await calls.ingest({ target: app, asOf, root: feed });
      ingested.push({ asOf, status });
    }
  }
  return { seeded, ingested, notes };
}
