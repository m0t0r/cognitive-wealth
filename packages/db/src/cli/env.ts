import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseEnv } from "node:util";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const WEB_DIR = join(REPO_ROOT, "apps/web");

/**
 * The CLIs' dev fallback: when `DATABASE_URL` isn't set, read `DATABASE_URL` and
 * `DATABASE_PASSWORD_FILE` from `apps/web/.env.local`, the file `pnpm dev` uses. A relative
 * password file is resolved against `apps/web`, as Next does, so any working directory works.
 * Returns the file it read, if any. An explicit `DATABASE_URL` skips the file entirely.
 */
export function loadWebEnvFallback(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.DATABASE_URL) return undefined;
  const file = join(WEB_DIR, ".env.local");
  if (!existsSync(file)) return undefined;
  const vars = parseEnv(readFileSync(file, "utf8"));
  if (vars.DATABASE_URL) env.DATABASE_URL = vars.DATABASE_URL;
  if (vars.DATABASE_PASSWORD_FILE && !env.DATABASE_PASSWORD_FILE) {
    env.DATABASE_PASSWORD_FILE = resolve(WEB_DIR, vars.DATABASE_PASSWORD_FILE);
  }
  return relative(REPO_ROOT, file);
}

/** `url` without its password, for telling the operator which database a CLI is writing to. */
export function describeDatabaseUrl(url: string): string {
  if (!URL.canParse(url)) return "(unparseable DATABASE_URL)";
  const parsed = new URL(url);
  parsed.password = "";
  parsed.search = "";
  return parsed.toString();
}
