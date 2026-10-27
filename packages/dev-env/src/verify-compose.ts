// `cw verify compose up|down`: compose.yaml's own services (the images, the custodian, migrations)
// from this checkout, in a Compose project of its own (#158), never the dev stack's
// `cognitive-wealth` or its volumes. The project (`cw-compose-<token>`) and its host ports come
// from `names.ts`, like `cw verify start`'s, so checkouts never share them, and a worktree's
// teardown removes its project with the volumes (`removeComposeProject`, which `down` runs too).
// A worktree has no `.secrets/`, so this one gets throwaway secrets in its own (gitignored)
// `.secrets/`; the main checkout's real ones are used there, in volumes of this project. Node runs
// the CLIs that import this directly (type stripping), so relative imports keep their `.ts`
// extension.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CliError } from "@repo/db/cli/cli-error";
import type { Checkout } from "./checkout.ts";
import { verifyResources } from "./names.ts";
import { type DomainCalls, type Populated, type RunResult, populate, tail } from "./populate.ts";

/** The override that publishes the project's `db` on the checkout's own port (its header says why). */
const DB_OVERRIDE = join(import.meta.dirname, "../compose.db.yaml");

/** One-shot services: `up --wait` counts one that exited, even with 0, as a failure. */
const ONE_SHOTS = new Set(["migrate", "custodian-migrate"]);

/** What `composeUp` reaches outside itself for; a test hands in its own. */
export type ComposeSystem = {
  /** `docker <args>` with `env` on top of this process's environment, captured. */
  docker: (args: { args: string[]; env: Record<string, string> }) => RunResult;
  populate: typeof populate;
};

export const defaultComposeSystem: ComposeSystem = {
  docker: ({ args, env }) => {
    const { status, stdout, stderr } = spawnSync("docker", args, {
      env: { ...process.env, ...env },
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return { status, stdout, stderr };
  },
  populate,
};

/**
 * Writes every secret `top`'s compose.yaml names that `.secrets/` lacks, as the loop in its header
 * makes them, and returns their names; existing files are kept.
 */
export function ensureSecrets(top: string): string[] {
  const names = [
    ...readFileSync(join(top, "compose.yaml"), "utf8").matchAll(
      /^\s*file: \.\/\.secrets\/(\S+)$/gm,
    ),
  ].map(([, name]) => name ?? "");
  const dir = join(top, ".secrets");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const missing = names.filter((name) => {
    const file = join(dir, name);
    return !existsSync(file) || statSync(file).size === 0;
  });
  for (const name of missing) {
    writeFileSync(join(dir, name), `${randomBytes(32).toString("hex")}\n`, { mode: 0o644 });
  }
  return missing;
}

export type ComposeUp = {
  /** The project's name: `docker compose -p <project> ps|logs|exec` reaches it. */
  project: string;
  urls: { web: string; custodian: string; mailpit: string };
  /** The project's database as `app`, from the host; only when `db` runs. */
  database?: string;
  passwordFile?: string;
  ingested: Populated["ingested"];
  notes: string[];
};

/** The project's name and its host ports, for `checkout`. */
export function composeProjectOfCheckout(checkout: Checkout) {
  return verifyResources(checkout.worktreeId).compose;
}

export async function composeUp({
  checkout,
  services,
  domain,
  system = defaultComposeSystem,
}: {
  checkout: Checkout;
  /** compose.yaml's services to start; all of them when empty. */
  services: string[];
  /** `cw`'s seed and Ingestion; without them, the checkout's own `cw … --json` runs. */
  domain?: DomainCalls | undefined;
  system?: ComposeSystem;
}): Promise<ComposeUp> {
  const { top } = checkout;
  const { project, ports } = composeProjectOfCheckout(checkout);
  ensureSecrets(top);
  const env = {
    WEB_PORT: String(ports.web),
    CUSTODIAN_PORT: String(ports.custodian),
    MAILPIT_PORT: String(ports.mailpit),
    DB_PORT: String(ports.db),
  };
  const compose = (args: string[]) => {
    const result = system.docker({
      args: [
        "compose",
        "-p",
        project,
        "--project-directory",
        top,
        "-f",
        join(top, "compose.yaml"),
        "-f",
        DB_OVERRIDE,
        ...args,
      ],
      env,
    });
    if (result.status !== 0) {
      throw new CliError({
        code: "compose_failed",
        message: `docker compose ${args.join(" ")} failed:\n${tail(result.stderr || result.stdout)}`,
      });
    }
    return result.stdout;
  };

  // A one-shot named here runs on its own, with `run`, which starts its database first and exits
  // with its exit code (#248). With none named, `up` starts them all, dependents included, and
  // waits on the one-shots through `service_completed_successfully`.
  const oneShots = services.filter((service) => ONE_SHOTS.has(service));
  const rest = services.filter((service) => !ONE_SHOTS.has(service));
  if (services.length === 0 || rest.length > 0)
    compose(["up", "--build", "--detach", "--wait", ...rest]);
  for (const oneShot of oneShots) compose(["run", "--rm", "--build", oneShot]);

  const urls = {
    web: `http://localhost:${ports.web}`,
    custodian: `http://127.0.0.1:${ports.custodian}`,
    mailpit: `http://127.0.0.1:${ports.mailpit}`,
  };
  const running = compose(["ps", "--status", "running", "--services"]).split("\n");
  if (!running.includes("db")) return { project, urls, ingested: [], notes: [] };

  // The same data as `cw verify start`'s servers, from the host through the published port, so
  // `owner@` signs in to Larkspur. Migrations again, in case `migrate` wasn't named; the seed and
  // Ingestion skip what an earlier `up` wrote.
  const url = (role: string) => `postgres://${role}@localhost:${ports.db}/cognitive_wealth`;
  const secrets = join(top, ".secrets");
  const { ingested, notes } = await system.populate({ checkout: top, url, secrets, domain });
  return {
    project,
    urls,
    database: url("app"),
    passwordFile: join(secrets, "db_app_password"),
    ingested,
    notes,
  };
}
