import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

// `pnpm org:deactivate` and `org:reactivate` both run this file with their command.
const CLI = join(import.meta.dirname, "../../../packages/db/src/cli/org-status.ts");

type OrgStatusArgs = {
  /** The worker's database, as `app` (`workerDatabase.appUrl`): the role the CLI uses in production. */
  databaseUrl: string;
  command: "deactivate" | "reactivate";
  slug: string;
  reason?: string;
};

/**
 * Runs the real `org:deactivate` or `org:reactivate` CLI under plain Node, as the operator would,
 * against this worker's database. Rejects with the CLI's output when it exits non-zero.
 */
export async function runOrgStatus({
  databaseUrl,
  command,
  slug,
  reason = "e2e",
}: OrgStatusArgs): Promise<string> {
  // The worker's database, and no password file from the runner's shell to override its password.
  const { DATABASE_PASSWORD_FILE: _, ...inherited } = process.env;
  const env = { ...inherited, DATABASE_URL: databaseUrl };
  const { stdout } = await run(
    process.execPath,
    [CLI, command, "--slug", slug, "--reason", reason],
    { env },
  );
  return stdout;
}
