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
 * A linked worktree is refused the fallback: its `.env.local` (copied by `.worktreeinclude`)
 * names the shared dev database, and a worktree's commands stay off it (#125).
 */
export function loadWebEnvFallback({
  env = process.env,
  root = REPO_ROOT,
}: { env?: NodeJS.ProcessEnv; root?: string } = {}): string | undefined {
  if (env.DATABASE_URL) return undefined;
  const webDir = join(root, "apps/web");
  const file = join(webDir, ".env.local");
  if (!existsSync(file)) return undefined;
  if (isLinkedWorktree(root)) {
    throw new Error(
      "DATABASE_URL is not set, and this checkout is a git worktree, so apps/web/.env.local's " +
        "database isn't used: it's the shared dev database. Set DATABASE_URL (and " +
        "DATABASE_PASSWORD_FILE) to a database of this task's own, or run the command from the " +
        "main checkout.",
    );
  }
  const vars = parseEnv(readFileSync(file, "utf8"));
  if (vars.DATABASE_URL) env.DATABASE_URL = vars.DATABASE_URL;
  if (vars.DATABASE_PASSWORD_FILE && !env.DATABASE_PASSWORD_FILE) {
    env.DATABASE_PASSWORD_FILE = resolve(webDir, vars.DATABASE_PASSWORD_FILE);
  }
  return relative(root, file);
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
