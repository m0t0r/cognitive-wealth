// Who `pnpm db:studio` signs in as. `app` may only read and add most rows (APP_PRIVILEGES) and
// needs a Firm set before it can read a Firm-scoped table (ADR 0020), which Studio can't do, so on
// a local development database Studio signs in as `migrator`, the tables' owner, which may edit
// and delete any row and isn't held by the row-level security policies. Anywhere else it keeps the
// URL's own role. Imports `seed-data.ts`, so a Node entry loads this after `registerTsResolution()`.
import { dirname, join } from "node:path";
import { assertSeedTarget } from "./seed-data.ts";

type StudioConnection = { url: string; passwordFile: string | undefined; role: string };

/** `migrator`'s password file, beside `app`'s in `.secrets/` (compose.yaml names both). */
const MIGRATOR_PASSWORD_FILE = "db_migrator_password";

export function studioConnection(env: NodeJS.ProcessEnv): StudioConnection {
  const url = env.DATABASE_URL ?? "";
  const passwordFile = env.DATABASE_PASSWORD_FILE;
  const given = { url, passwordFile, role: decodeURIComponent(new URL(url).username) };
  if (!passwordFile) return given;
  try {
    assertSeedTarget(url, env.NODE_ENV);
  } catch {
    return given;
  }
  const migrator = new URL(url);
  migrator.username = "migrator";
  return {
    url: migrator.toString(),
    passwordFile: join(dirname(passwordFile), MIGRATOR_PASSWORD_FILE),
    role: "migrator",
  };
}
