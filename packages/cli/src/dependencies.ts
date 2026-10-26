// What `cw`'s commands reach outside themselves for: the database and the checkout. `createCli`
// takes them as one object, so a test hands in its own (a test database, a fake sweep) and runs
// the real command in-process. The defaults load their modules only when a command asks, so
// `cw dev prune` never loads the database schema and `cw org …` never loads `@repo/dev-env`.
import type { Database } from "@repo/db";
import { CliError } from "@repo/db/cli/cli-error";

export type OpenedDatabase = {
  db: Database;
  close: () => Promise<void>;
  /** The database, without its password, and the file it came from, for the command's output. */
  target: string;
};

export type DevEnv = {
  /** The main checkout of the repository `cw` runs in. */
  mainCheckout: string;
  findOrphans: typeof import("@repo/dev-env/prune").findOrphans;
  prune: typeof import("@repo/dev-env/prune").prune;
};

export type Dependencies = {
  /** A connection of one, on `DATABASE_URL` or `apps/web/.env.local`'s; the command closes it. */
  openDatabase: () => Promise<OpenedDatabase>;
  devEnv: () => Promise<DevEnv>;
};

export const defaultDependencies: Dependencies = {
  async openDatabase() {
    const { describeDatabaseUrl, loadWebEnvFallback } = await import("@repo/db/cli/env");
    const { connectionConfig } = await import("@repo/db/config");
    const { connect } = await import("@repo/db/connect");
    let envFile: string | undefined;
    let config;
    try {
      envFile = loadWebEnvFallback();
      config = connectionConfig();
    } catch (error) {
      throw new CliError({
        code: "no_database",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    const { db, close } = connect(config, { max: 1 });
    const from = envFile ? ` (from ${envFile})` : "";
    return { db, close, target: `${describeDatabaseUrl(config.url)}${from}` };
  },
  async devEnv() {
    const { checkoutAt } = await import("@repo/dev-env/checkout");
    const { findOrphans, prune } = await import("@repo/dev-env/prune");
    return { mainCheckout: checkoutAt(process.cwd()).mainCheckout, findOrphans, prune };
  },
};
