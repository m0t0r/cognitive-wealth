// What `cw`'s commands reach outside themselves for: the database, the checkout, GitHub and
// Claude. `createCli` takes them as one object, so a test hands in its own (a test database, a
// fake sweep, issues in memory, a canned answer) and runs the real command in-process. The defaults
// load their modules only when a command asks, so `cw dev prune` never loads the database schema
// and `cw org …` never loads `@repo/dev-env` or the AI SDK.
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "@repo/db";
import { CliError } from "@repo/db/cli/cli-error";
import type { FixArgs, FixOutcome } from "@repo/friction-bot/fix";
import type { GitHub } from "@repo/friction-bot/github";
import type { TriageInput } from "@repo/friction-bot/reports";
import type { Triage } from "@repo/friction-bot/triage";

export type OpenedDatabase = {
  db: Database;
  close: () => Promise<void>;
  /** The database, without its password, and the file it came from, for the command's output. */
  target: string;
  /** Whether it's a local development database, one the seed may write (`assertSeedTarget`). */
  local: boolean;
};

export type OpenDatabaseArgs = {
  /**
   * Sign in as `migrator`, the tables' owner, whom row-level security doesn't hold: itself on a
   * local database, as `db:studio` does (`studioConnection`); anywhere else `DATABASE_URL` must
   * name it.
   */
  asMigrator?: boolean;
};

export type DevEnv = import("@repo/dev-env/checkout").Checkout & {
  findOrphans: typeof import("@repo/dev-env/prune").findOrphans;
  prune: typeof import("@repo/dev-env/prune").prune;
  setUpWorktree: typeof import("@repo/dev-env/setup").setUpWorktree;
  teardownTargetAt: typeof import("@repo/dev-env/teardown").teardownTargetAt;
  tearDown: typeof import("@repo/dev-env/teardown").tearDown;
};

/** The Claude calls behind `cw friction`, each needing `ANTHROPIC_API_KEY`. */
export type Claude = {
  /** One triage decision (Haiku), given the gathered report; the repo's guides are added. */
  triage: (input: TriageInput) => Promise<Triage>;
  /** The fixer's tool loop (Sonnet), in `root` or else the checkout `cw` runs from. */
  fix: (args: Omit<FixArgs, "root" | "model"> & { root?: string }) => Promise<FixOutcome>;
};

export type Dependencies = {
  /** A connection of one, on `DATABASE_URL` or `apps/web/.env.local`'s; the command closes it. */
  openDatabase: (args?: OpenDatabaseArgs) => Promise<OpenedDatabase>;
  devEnv: () => Promise<DevEnv>;
  /** This repository's issues, through `gh`. */
  github: () => Promise<GitHub>;
  claude: () => Promise<Claude>;
};

/** The checkout `cw` runs from, whose CLAUDE.md and docs triage reads and the fixer edits. */
const ROOT = join(import.meta.dirname, "../../..");

const read = (path: string) => readFile(join(ROOT, path), "utf8");

export const defaultDependencies: Dependencies = {
  async openDatabase({ asMigrator = false } = {}) {
    const { describeDatabaseUrl, loadWebEnvFallback } = await import("@repo/db/cli/env");
    const { connectionConfig } = await import("@repo/db/config");
    const { connect } = await import("@repo/db/connect");
    const { assertSeedTarget } = await import("@repo/db/seed-data");
    const { studioConnection } = await import("@repo/db/cli/studio-connection");
    let envFile: string | undefined;
    let config;
    let as = "";
    try {
      envFile = loadWebEnvFallback();
      if (asMigrator) {
        if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
        const { url, passwordFile, role } = studioConnection(process.env);
        const password = passwordFile ? () => readFileSync(passwordFile, "utf8").trim() : undefined;
        config = { url, password };
        as = ` as ${role}`;
      } else {
        config = connectionConfig();
      }
    } catch (error) {
      throw new CliError({
        code: "no_database",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    const { db, close } = connect(config, { max: 1 });
    const from = envFile ? ` (from ${envFile})` : "";
    return {
      db,
      close,
      target: `${describeDatabaseUrl(config.url)}${as}${from}`,
      local: isLocal(() => assertSeedTarget(config.url, process.env.NODE_ENV)),
    };
  },
  async devEnv() {
    const { checkoutAt } = await import("@repo/dev-env/checkout");
    const { findOrphans, prune } = await import("@repo/dev-env/prune");
    const { setUpWorktree } = await import("@repo/dev-env/setup");
    const { tearDown, teardownTargetAt } = await import("@repo/dev-env/teardown");
    return {
      ...checkoutAt(process.cwd()),
      findOrphans,
      prune,
      setUpWorktree,
      teardownTargetAt,
      tearDown,
    };
  },
  async github() {
    const { ghCli } = await import("@repo/friction-bot/github");
    return ghCli();
  },
  // The AI SDK reads ANTHROPIC_API_KEY on the first call; without it the call fails as
  // `no_api_key` (`api-error.ts`), before triage or the fixer has changed anything.
  async claude() {
    const { callingTheApi } = await import("@repo/friction-bot/api-error");
    const { triage } = await import("@repo/friction-bot/triage");
    const { fix } = await import("@repo/friction-bot/fix");
    return {
      triage: async (input) => {
        const [guide, claudeMd] = await Promise.all([
          read("docs/agents/friction.md"),
          read("CLAUDE.md"),
        ]);
        return await callingTheApi(() => triage({ ...input, guide, claudeMd }));
      },
      fix: async (args) => {
        // friction-fix.yml hands the key over as a file, so the checks the fixer runs can't read
        // it from this process's environment (`api-key.ts`).
        const { modelFromKeyFile } = await import("@repo/friction-bot/api-key");
        const { FIX_MODEL } = await import("@repo/friction-bot/fix");
        const model = await modelFromKeyFile(FIX_MODEL);
        return await callingTheApi(() =>
          fix({ ...args, root: args.root ?? ROOT, ...(model ? { model } : {}) }),
        );
      },
    };
  },
};

/** Whether `assertLocal` passes, rather than refusing a remote database or production. */
function isLocal(assertLocal: () => void): boolean {
  try {
    assertLocal();
    return true;
  } catch {
    return false;
  }
}
