// `cw verify start`: the production build of `web` on the host, against the throwaway verification
// services (compose.verify.yaml), never the dev stack: the standalone server the Docker image runs,
// without building an image. Each run gives the server a fresh database (migrated, seeded, with the
// custodian's example Deliveries ingested, `populate.ts`) and its own Redis key prefix.
//
// Without a ref it serves this checkout; with one (say the PR's base, for "before" captures) it
// checks the ref out into the main checkout's `.dev/worktrees/<token>-<sha>`, builds and serves it
// there, from a database migrated by that ref's own migrations. Every checkout has its own port
// pair, databases and state under the main checkout's `.dev/verify/<token>/` (`names.ts`), so runs
// from different worktrees never touch each other's, and teardown (`verify.ts`) removes them.
// Turbo restores an unchanged build from its cache, so a rerun costs seconds, not a rebuild.
// Node runs the CLIs that import this directly (type stripping), so relative imports keep their
// `.ts` extension.
import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { CliError } from "@repo/db/cli/cli-error";
import type { Checkout } from "./checkout.ts";
import { VERIFY_PORTS } from "./env-file.ts";
import { verifyResources } from "./names.ts";
import { type DomainCalls, type Populated, populate } from "./populate.ts";
import {
  type RunResult,
  checked,
  commandOf,
  listenerOn,
  runCommand,
  stop,
  tail,
} from "./processes.ts";
import {
  assertSecrets,
  householdsIn,
  recreateDatabase,
  secretsDir,
  startServices,
} from "./services.ts";
import { type ServerRole, isWebServer, refCheckoutsDir, serverFilesOf } from "./verify.ts";

type ExecArgs = { command: string; args: string[]; cwd: string; env?: Record<string, string> };

/** What starting a server reaches outside itself for; a test hands in its own. */
export type ServerSystem = {
  listenerOn: (port: number) => number | undefined;
  commandOf: (pid: number) => string | undefined;
  stop: (pid: number) => Promise<boolean>;
  /** Runs a command to its end, captured. */
  exec: (args: ExecArgs) => RunResult;
  startServices: typeof startServices;
  recreateDatabase: typeof recreateDatabase;
  populate: typeof populate;
  householdsIn: typeof householdsIn;
  /** Copies what Next leaves out of `.next/standalone` into it (`layOutStandalone`). */
  layOutStandalone: (web: string) => void;
  /** Starts `script` detached, its output to `log`, and returns its pid. */
  spawnServer: (args: { script: string; env: Record<string, string>; log: string }) => number;
  /** Whether `url`'s health check answers before the deadline. */
  waitHealthy: (url: string) => Promise<boolean>;
  now: () => number;
};

/**
 * Lays the standalone server out as the Docker image does (and e2e's global setup): Next leaves the
 * client assets and `public/` out of `.next/standalone`, so without them every `/_next/static/*`
 * 404s. A fresh copy each time, since a `--ref` checkout or a cached build never got one.
 */
function layOutStandalone(web: string) {
  const standalone = join(web, ".next/standalone/apps/web");
  for (const [from, to] of [
    [join(web, ".next/static"), join(standalone, ".next/static")],
    [join(web, "public"), join(standalone, "public")],
  ] as const) {
    rmSync(to, { recursive: true, force: true });
    cpSync(from, to, { recursive: true });
  }
}

function spawnServer({
  script,
  env,
  log,
}: {
  script: string;
  env: Record<string, string>;
  log: string;
}) {
  const out = openSync(log, "w");
  // Detached in a session of its own, so it outlives `cw` and a Ctrl-C in the agent's shell.
  const child = spawn(process.execPath, [script], {
    env,
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();
  if (child.pid === undefined) throw new Error(`Couldn't start ${script}`);
  return child.pid;
}

const HEALTH_TRIES = 60;

async function waitHealthy(url: string): Promise<boolean> {
  for (let tries = HEALTH_TRIES; tries > 0; tries -= 1) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- one try at a time, until one answers
      if ((await fetch(`${url}/api/health`)).ok) return true;
    } catch {
      // Not listening yet.
    }
    // oxlint-disable-next-line no-await-in-loop -- the wait between tries
    await sleep(500);
  }
  return false;
}

export const defaultServerSystem: ServerSystem = {
  listenerOn,
  commandOf,
  stop,
  exec: runCommand,
  startServices: (args) => {
    assertSecrets(args.mainCheckout);
    startServices(args);
  },
  recreateDatabase,
  populate,
  householdsIn,
  layOutStandalone,
  spawnServer,
  waitHealthy,
  now: Date.now,
};

export type StartServerArgs = {
  checkout: Checkout;
  /** A git ref to build and serve instead of this checkout, e.g. the PR's base. */
  ref?: string | undefined;
  /** The port to serve on; the checkout's own for the role by default. */
  port?: number | undefined;
  /** `<absolute file>:<export>`: one more seed function, run from this checkout after the world. */
  seed?: string | undefined;
  /** `cw`'s seed and Ingestion, used for this checkout; a `--ref` runs its own `cw` instead. */
  domain?: DomainCalls | undefined;
  system?: ServerSystem | undefined;
};

export type PlannedServer = {
  url: string;
  role: ServerRole;
  database: string;
  passwordFile: string;
  /** The checkout built and served. */
  checkout: string;
  log: string;
  /** This checkout's own server for the role, which the run replaces. */
  replaces: number | undefined;
};

export type StartedServer = Omit<PlannedServer, "replaces"> & {
  pid: number;
  households: Array<{ name: string; publicId: string }>;
  ingested: Populated["ingested"];
  notes: string[];
  /** What `--seed`'s function printed. */
  seed?: string;
};

const describePid = ({ system, pid }: { system: ServerSystem; pid: number }) =>
  `pid ${pid}: ${(system.commandOf(pid) ?? "gone").slice(0, 120)}`;

type Plan = PlannedServer & {
  sha: string | undefined;
  port: number;
  token: string;
  dbName: string;
  pidfile: string;
};

function planServer({
  checkout,
  ref,
  port,
  system,
}: StartServerArgs & { system: ServerSystem }): Plan {
  const { mainCheckout, top, worktreeId } = checkout;
  const { token, ports, databases } = verifyResources(worktreeId);
  const role = ref === undefined ? "head" : "ref";
  let sha: string | undefined;
  if (ref !== undefined) {
    const parsed = system.exec({
      command: "git",
      args: ["rev-parse", "--short", `${ref}^{commit}`],
      cwd: top,
    });
    sha = parsed.stdout.trim();
    if (parsed.status !== 0 || !sha) {
      throw new CliError({
        code: "unknown_ref",
        message: `git knows no commit ${ref}: ${tail(parsed.stderr)}`,
      });
    }
  }
  const served = sha === undefined ? top : join(refCheckoutsDir(mainCheckout), `${token}-${sha}`);
  const servedPort = port ?? ports[role];
  const dbName = databases[role];
  const files = serverFilesOf({ mainCheckout, token, role });
  // Only a server this checkout recorded for this role is ours to replace, while its pid is still
  // a standalone web server (the system may have reused it).
  const recorded = existsSync(files.pid) ? Number(readFileSync(files.pid, "utf8").trim()) : 0;
  const replaces = recorded > 0 && isWebServer(system.commandOf(recorded)) ? recorded : undefined;

  // Before anything changes: a port held by anything but our own server is refused, so a clash
  // with another worktree's server leaves its database and process alone.
  const listener = system.listenerOn(servedPort);
  if (listener !== undefined && listener !== replaces) {
    throw new CliError({
      code: "port_taken",
      message:
        `Port ${servedPort} is taken by another process (${describePid({ system, pid: listener })}), ` +
        "perhaps another worktree's server. Nothing was changed; pass --port with a free one.",
    });
  }
  return {
    url: `http://localhost:${servedPort}`,
    role,
    database: `postgres://app@localhost:${VERIFY_PORTS.postgres}/${dbName}`,
    passwordFile: join(secretsDir(mainCheckout), "db_app_password"),
    checkout: served,
    log: files.log,
    replaces,
    sha,
    port: servedPort,
    token,
    dbName,
    pidfile: files.pid,
  };
}

/** What `startVerifyServer` would serve, with the same port check; changes nothing. */
export function planVerifyServer({
  system = defaultServerSystem,
  ...args
}: StartServerArgs): PlannedServer {
  const { url, role, database, passwordFile, checkout, log, replaces } = planServer({
    ...args,
    system,
  });
  return { url, role, database, passwordFile, checkout, log, replaces };
}

/** Builds and starts the server, replacing this checkout's own for the role; never another's. */
export async function startVerifyServer({
  system = defaultServerSystem,
  ...args
}: StartServerArgs): Promise<StartedServer> {
  const planned = planServer({ ...args, system });
  const { mainCheckout, top } = args.checkout;
  const secrets = secretsDir(mainCheckout);

  if (planned.sha !== undefined) {
    if (!existsSync(planned.checkout)) {
      checked({
        result: system.exec({
          command: "git",
          args: ["-C", mainCheckout, "worktree", "add", "--detach", planned.checkout, planned.sha],
          cwd: top,
        }),
        code: "checkout_failed",
        what: `Checking ${args.ref} out`,
      });
    }
    checked({
      result: system.exec({
        command: "pnpm",
        args: ["install", "--frozen-lockfile", "--prefer-offline", "--silent"],
        cwd: planned.checkout,
      }),
      code: "install_failed",
      what: `Installing ${planned.checkout}'s dependencies`,
    });
  }

  system.startServices({ mainCheckout, top });
  await system.recreateDatabase({ mainCheckout, database: planned.dbName });
  const url = (role: string) =>
    `postgres://${role}@localhost:${VERIFY_PORTS.postgres}/${planned.dbName}`;
  const populated = await system.populate({
    checkout: planned.checkout,
    url,
    secrets,
    domain: planned.sha === undefined ? args.domain : undefined,
  });
  checked({
    result: system.exec({
      command: "pnpm",
      args: ["exec", "turbo", "build", "--filter=web", "--output-logs=errors-only"],
      cwd: planned.checkout,
    }),
    code: "build_failed",
    what: "turbo build --filter=web",
  });

  // From this checkout even with a ref, so before and after get the same data (#164).
  let seed: string | undefined;
  if (args.seed !== undefined) {
    seed = checked({
      result: system.exec({
        command: "node",
        args: [join(top, "packages/db/src/cli/run-seed.ts"), args.seed],
        cwd: top,
        env: { DATABASE_URL: url("app"), DATABASE_PASSWORD_FILE: join(secrets, "db_app_password") },
      }),
      code: "seed_failed",
      what: `The seed ${args.seed}`,
    });
  }
  // Each run's ids are new, so the Households' publicIds are what URLs are built from.
  const households = await system.householdsIn({ mainCheckout, database: planned.dbName });

  const web = join(planned.checkout, "apps/web");
  system.layOutStandalone(web);
  if (planned.replaces !== undefined && !(await system.stop(planned.replaces))) {
    throw new CliError({
      code: "stop_failed",
      message: `The last server (pid ${planned.replaces}) won't exit.`,
    });
  }
  // Again, since the build took a while: a server that took the port meanwhile would answer the
  // health check in place of ours.
  const listener = system.listenerOn(planned.port);
  if (listener !== undefined) {
    throw new CliError({
      code: "port_taken",
      message:
        `Port ${planned.port} was taken during the build (${describePid({ system, pid: listener })}); ` +
        "pass --port with a free one.",
    });
  }

  mkdirSync(dirname(planned.pidfile), { recursive: true });
  // The production container's environment (compose.yaml's `web`), on the verify services, and
  // nothing else of this process's.
  const pid = system.spawnServer({
    script: join(web, ".next/standalone/apps/web/server.js"),
    log: planned.log,
    env: {
      // The shell's, which a Turborepo task never reads: `cw` isn't one.
      // oxlint-disable-next-line turbo/no-undeclared-env-vars
      PATH: process.env.PATH ?? "",
      // oxlint-disable-next-line turbo/no-undeclared-env-vars
      HOME: process.env.HOME ?? "",
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: String(planned.port),
      BETTER_AUTH_URL: planned.url,
      BETTER_AUTH_SECRET_FILE: join(secrets, "better_auth_secret"),
      DATABASE_URL: planned.database,
      DATABASE_PASSWORD_FILE: planned.passwordFile,
      REDIS_URL: `redis://app@localhost:${VERIFY_PORTS.redis}`,
      REDIS_PASSWORD_FILE: join(secrets, "redis_password"),
      // A new prefix per run, so rate limits start over.
      REDIS_KEY_PREFIX: `cw:v:${planned.token}:${planned.role}:${Math.floor(system.now() / 1000)}:`,
      EMAIL_TRANSPORT: "smtp",
      SMTP_URL: `smtp://localhost:${VERIFY_PORTS.smtp}`,
      EMAIL_FROM: "Cognitive Wealth <no-reply@cognitive-wealth.localhost>",
      AUTH_TRUSTED_IP_HEADER: "x-forwarded-for",
    },
  });
  writeFileSync(planned.pidfile, `${pid}\n`);
  if (!(await system.waitHealthy(planned.url))) {
    throw new CliError({
      code: "unhealthy",
      message: `The server (pid ${pid}) didn't become healthy; see ${planned.log}.`,
    });
  }
  return {
    url: planned.url,
    role: planned.role,
    pid,
    database: planned.database,
    passwordFile: planned.passwordFile,
    households,
    ingested: populated.ingested,
    notes: populated.notes,
    checkout: planned.checkout,
    log: planned.log,
    ...(seed !== undefined && { seed }),
  };
}
