// What `cw`'s commands reach outside themselves for: the database, the checkout and its dev
// environment, what verifier-web left, GitHub, Claude, and the cve.now scan. `createCli` takes them as one object, so a
// test hands in its own (a test database, a fake sweep, issues in memory, a canned answer) and runs
// the real command in-process. The defaults load their modules only when a command asks, so
// `cw dev prune` never loads the database schema and `cw org …` never loads `@repo/dev-env` or
// the AI SDK.
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "@repo/db";
import { CliError } from "@repo/db/cli/cli-error";
import type { FixArgs, FixOutcome } from "@repo/friction-bot/fix";
import type { GitHub } from "@repo/friction-bot/github";
import type { Check, CheckResult } from "@repo/friction-bot/tools";
import type { TriageInput } from "@repo/friction-bot/reports";
import type { TriageDecision } from "@repo/friction-bot/triage";
import { REPO_ROOT } from "./paths.ts";

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
  /**
   * This database instead of `DATABASE_URL`'s, as its URL's role, with the password in
   * `passwordFile`: a verification database `cw verify` seeds.
   */
  target?: { url: string; passwordFile: string } | undefined;
};

export type DevEnv = import("@repo/dev-env/checkout").Checkout & {
  findOrphans: typeof import("@repo/dev-env/prune").findOrphans;
  prune: typeof import("@repo/dev-env/prune").prune;
  setUpWorktree: typeof import("@repo/dev-env/setup").setUpWorktree;
  teardownTargetAt: typeof import("@repo/dev-env/teardown").teardownTargetAt;
  tearDown: typeof import("@repo/dev-env/teardown").tearDown;
};

/** The verifier-web skill's runs from this checkout: starting them, and what they left. */
export type Verify = import("@repo/dev-env/checkout").Checkout & {
  planVerifyServer: typeof import("@repo/dev-env/verify-server").planVerifyServer;
  startVerifyServer: typeof import("@repo/dev-env/verify-server").startVerifyServer;
  sessionFileOf: typeof import("@repo/dev-env/verify-browser").sessionFileOf;
  startBrowser: typeof import("@repo/dev-env/verify-browser").startBrowser;
  composeUp: typeof import("@repo/dev-env/verify-compose").composeUp;
  removeComposeProject: typeof import("@repo/dev-env/verify").removeComposeProject;
  verifyServersOf: typeof import("@repo/dev-env/verify").verifyServersOf;
  stopVerifyServers: typeof import("@repo/dev-env/verify").stopVerifyServers;
  refCheckoutsOf: typeof import("@repo/dev-env/verify").refCheckoutsOf;
  removeRefCheckouts: typeof import("@repo/dev-env/verify").removeRefCheckouts;
  chromeHolder: typeof import("@repo/dev-env/verify").chromeHolder;
  releaseChrome: typeof import("@repo/dev-env/verify").releaseChrome;
};

/** The Claude calls behind `cw friction`, each needing `ANTHROPIC_API_KEY`. */
export type Claude = {
  /**
   * One triage decision (Haiku, which reads this checkout), given the gathered report; the repo's
   * guides are added.
   */
  triage: (input: TriageInput) => Promise<TriageDecision>;
  /** The fixer's tool loop (Sonnet), in `root` or else the checkout `cw` runs from. */
  fix: (args: Omit<FixArgs, "root" | "model"> & { root?: string }) => Promise<FixOutcome>;
};

/** Runs one of the repo's checks (`pnpm <check>`) in a checkout, without the secrets. */
export type RunCheck = (args: { root: string; check: Check }) => Promise<CheckResult>;

export type CveScan = {
  /** The checkout whose lockfiles and pins are scanned. */
  root: string;
  /** From GITHUB_TOKEN and GITHUB_REPOSITORY, when both are set (GitHub Actions sets them). */
  github: import("@repo/cve-scan/github").GitHub | undefined;
  /** GITHUB_STEP_SUMMARY: the file a workflow step's Markdown summary is appended to. */
  stepSummaryFile: string | undefined;
  scan: typeof import("@repo/cve-scan/scan").scan;
  reportedIds: typeof import("@repo/cve-scan/github").reportedIds;
  fileIssues: typeof import("@repo/cve-scan/publish").fileIssues;
};

export type Dependencies = {
  /** A connection of one, on `DATABASE_URL` or `apps/web/.env.local`'s; the command closes it. */
  openDatabase: (args?: OpenDatabaseArgs) => Promise<OpenedDatabase>;
  devEnv: () => Promise<DevEnv>;
  verify: () => Promise<Verify>;
  /** This repository's issues, through `gh`. */
  github: () => Promise<GitHub>;
  claude: () => Promise<Claude>;
  /** The checks `cw friction commit` runs before it commits a fix. */
  checks: () => Promise<RunCheck>;
  cveScan: () => Promise<CveScan>;
};

/** The checkout `cw` runs from, whose CLAUDE.md and docs triage reads and the fixer edits. */
const ROOT = join(import.meta.dirname, "../../..");

const read = (path: string) => readFile(join(ROOT, path), "utf8");

export const defaultDependencies: Dependencies = {
  async cveScan() {
    const { scan } = await import("@repo/cve-scan/scan");
    const { reportedIds } = await import("@repo/cve-scan/github");
    const { fileIssues } = await import("@repo/cve-scan/publish");
    // Set by GitHub Actions. `cw` isn't a Turborepo task, so turbo.json needn't list them.
    // oxlint-disable-next-line turbo/no-undeclared-env-vars
    const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repository, GITHUB_STEP_SUMMARY } = process.env;
    return {
      root: REPO_ROOT,
      github: token && repository ? { token, repository } : undefined,
      stepSummaryFile: GITHUB_STEP_SUMMARY || undefined,
      scan,
      reportedIds,
      fileIssues,
    };
  },
  async openDatabase({ asMigrator = false, target } = {}) {
    const { describeDatabaseUrl, loadWebEnvFallback } = await import("@repo/db/cli/env");
    const { connectionConfig } = await import("@repo/db/config");
    const { connect } = await import("@repo/db/connect");
    const { assertSeedTarget } = await import("@repo/db/seed-data");
    const { studioConnection } = await import("@repo/db/cli/studio-connection");
    let envFile: string | undefined;
    let config;
    let asRole = "";
    try {
      if (target) {
        const { passwordFile } = target;
        config = { url: target.url, password: () => readFileSync(passwordFile, "utf8").trim() };
      } else {
        envFile = loadWebEnvFallback();
        if (asMigrator) {
          if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
          const { url, passwordFile, role } = studioConnection(process.env);
          const password = passwordFile
            ? () => readFileSync(passwordFile, "utf8").trim()
            : undefined;
          config = { url, password };
          asRole = ` as ${role}`;
        } else {
          config = connectionConfig();
        }
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
      target: `${describeDatabaseUrl(config.url)}${asRole}${from}`,
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
  async verify() {
    const { checkoutAt } = await import("@repo/dev-env/checkout");
    const verify = await import("@repo/dev-env/verify");
    const { planVerifyServer, startVerifyServer } = await import("@repo/dev-env/verify-server");
    const { sessionFileOf, startBrowser } = await import("@repo/dev-env/verify-browser");
    const { composeUp } = await import("@repo/dev-env/verify-compose");
    return {
      ...checkoutAt(process.cwd()),
      planVerifyServer,
      startVerifyServer,
      sessionFileOf,
      startBrowser,
      composeUp,
      removeComposeProject: verify.removeComposeProject,
      verifyServersOf: verify.verifyServersOf,
      stopVerifyServers: verify.stopVerifyServers,
      refCheckoutsOf: verify.refCheckoutsOf,
      removeRefCheckouts: verify.removeRefCheckouts,
      chromeHolder: verify.chromeHolder,
      releaseChrome: verify.releaseChrome,
    };
  },
  async github() {
    const { ghCli } = await import("@repo/friction-bot/github");
    return ghCli();
  },
  async checks() {
    const { runCheck } = await import("@repo/friction-bot/tools");
    return runCheck;
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
        return await callingTheApi(() => triage({ ...input, guide, claudeMd, root: ROOT }));
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
