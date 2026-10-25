import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parseEnv } from "node:util";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");

/**
 * The CLIs' dev fallback: when `DATABASE_URL` isn't set, read `DATABASE_URL` and
 * `DATABASE_PASSWORD_FILE` from `apps/web/.env.local`, the file `pnpm dev` uses. A relative
 * password file is resolved against `apps/web`, as Next does, so any working directory works.
 * Returns the file it read, if any. An explicit `DATABASE_URL` skips the file entirely.
 *
 * In a linked worktree it reads only the worktree's own database, the `wt_*` one on the
 * verification Postgres that `pnpm dev` (`@repo/dev-env`) writes there, and refuses anything else:
 * a worktree's commands stay off the shared dev database (#125, #137).
 */
export function loadWebEnvFallback({
  env = process.env,
  root = REPO_ROOT,
}: { env?: NodeJS.ProcessEnv; root?: string } = {}): string | undefined {
  if (env.DATABASE_URL) return undefined;
  const webDir = join(root, "apps/web");
  const file = join(webDir, ".env.local");
  if (!existsSync(file)) return undefined;
  const vars = parseEnv(readFileSync(file, "utf8"));
  if (isLinkedWorktree(root) && !isWorktreeDatabase(vars.DATABASE_URL)) {
    throw new Error(
      "DATABASE_URL is not set, and this checkout is a git worktree, so apps/web/.env.local's " +
        "database isn't used: it isn't this worktree's own. Run `pnpm dev:env` to give the " +
        "worktree its database (or set DATABASE_URL and DATABASE_PASSWORD_FILE), or run the " +
        "command from the main checkout.",
    );
  }
  if (vars.DATABASE_URL) env.DATABASE_URL = vars.DATABASE_URL;
  if (vars.DATABASE_PASSWORD_FILE && !env.DATABASE_PASSWORD_FILE) {
    env.DATABASE_PASSWORD_FILE = resolve(webDir, vars.DATABASE_PASSWORD_FILE);
  }
  return relative(root, file);
}

/**
 * Whether `url` is a worktree's own database: `wt_<token>` on the verification Postgres (:5433),
 * as `@repo/dev-env` names it. That package depends on this one, so the shape is repeated here.
 */
function isWorktreeDatabase(url: string | undefined): boolean {
  if (!url || !URL.canParse(url)) return false;
  const { port, pathname } = new URL(url);
  return port === "5433" && /^\/wt_[a-z0-9_]+$/.test(pathname);
}

/** Whether `root` is a linked worktree rather than its repository's main checkout. */
function isLinkedWorktree(root: string): boolean {
  try {
    const commonDir = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return realpathSync(dirname(commonDir.trim())) !== realpathSync(root);
  } catch {
    return false;
  }
}

/** `url` without its password, for telling the operator which database a CLI is writing to. */
export function describeDatabaseUrl(url: string): string {
  if (!URL.canParse(url)) return "(unparseable DATABASE_URL)";
  const parsed = new URL(url);
  parsed.password = "";
  parsed.search = "";
  return parsed.toString();
}
