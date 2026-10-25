// Removes what a worktree's setup created: its `pnpm dev` server, its database and its Redis keys,
// then its record. Node runs the CLIs that import this directly (type stripping), so relative
// imports keep their `.ts` extension.
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { deleteRecord, type WorktreeRecord } from "./registry.ts";
import { connectAdmin, connectJanitor, isRefused } from "./services.ts";

/** What to remove: a record, or for a worktree that left none, just the names. */
export type TeardownTarget = Pick<WorktreeRecord, "token" | "database" | "redisPrefix"> &
  Partial<Pick<WorktreeRecord, "server">>;

const STOP_TIMEOUT_MS = 10_000;

/** The command line of `pid`, or undefined when no such process is running. */
function commandOf(pid: number): string | undefined {
  try {
    return execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

function alive(pid: number) {
  try {
    // Signal 0 checks the process (or, for a negative pid, the group) exists without touching it.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid: number, deadline = Date.now() + STOP_TIMEOUT_MS): Promise<boolean> {
  if (!alive(pid)) return true;
  if (Date.now() > deadline) return false;
  await sleep(100);
  return waitForExit(pid, deadline);
}

/** SIGTERM, then SIGKILL after a grace period. Returns false if it still runs. */
async function stop(pid: number) {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return true;
  }
  if (await waitForExit(pid)) return true;
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return true;
  }
  return waitForExit(pid);
}

/**
 * Stops the worktree's `pnpm dev`: the wrapper first, which stops `next dev`'s group and exits (so
 * portless drops the route), then the group itself in case the wrapper died without doing that.
 * A pid is only signalled while its command line is still the one setup started, so a pid the
 * system has since reused is left alone.
 */
async function stopServer(server: NonNullable<TeardownTarget["server"]>): Promise<string> {
  const stopped: string[] = [];
  if (commandOf(server.pid)?.includes("dev-env/src/cli/dev.ts")) {
    if (!(await stop(server.pid))) throw new Error(`pnpm dev (pid ${server.pid}) won't exit`);
    stopped.push(`pnpm dev (pid ${server.pid})`);
  }
  if (alive(-server.group) && /\bnext\b/.test(commandOf(server.group) ?? "next")) {
    if (!(await stop(-server.group)))
      throw new Error(`next dev (group ${server.group}) won't exit`);
    stopped.push(`next dev (group ${server.group})`);
  }
  return stopped.length > 0 ? `stopped ${stopped.join(" and ")}` : "no pnpm dev was running";
}

async function dropDatabase({
  mainCheckout,
  database,
}: {
  mainCheckout: string;
  database: string;
}) {
  const { client, close } = connectAdmin(mainCheckout);
  try {
    const [existing] = await client`select 1 from pg_database where datname = ${database}`;
    if (!existing) return `no database ${database}`;
    // `with (force)` ends open connections, which would otherwise block the drop.
    await client.unsafe(`drop database "${database}" with (force)`);
    return `dropped database ${database}`;
  } catch (error) {
    // The verification Postgres keeps its data in memory: if it isn't running, nothing is left.
    if (isRefused(error)) return "the verification Postgres isn't running, so no database is left";
    throw error;
  } finally {
    await close();
  }
}

async function deleteKeys({ mainCheckout, prefix }: { mainCheckout: string; prefix: string }) {
  let janitor;
  try {
    janitor = await connectJanitor(mainCheckout);
  } catch (error) {
    if (isRefused(error)) return "the verification Redis isn't running, so no keys are left";
    throw error;
  }
  try {
    return `deleted ${await janitor.deletePrefix(prefix)} Redis keys under ${prefix}`;
  } finally {
    await janitor.close();
  }
}

/**
 * Tears `target` down. Every step runs even when an earlier one fails, and the record is only
 * deleted once all of them succeed, so a retry (or prune) still finds what's left. Throws with
 * every failure; returns one line per step otherwise. Running it again is harmless.
 */
export async function tearDown({
  mainCheckout,
  target,
}: {
  mainCheckout: string;
  target: TeardownTarget;
}): Promise<string[]> {
  const steps: Array<[string, () => Promise<string>]> = [
    [
      "stop pnpm dev",
      async () => (target.server ? stopServer(target.server) : "no pnpm dev was recorded"),
    ],
    ["drop the database", () => dropDatabase({ mainCheckout, database: target.database })],
    ["delete the Redis keys", () => deleteKeys({ mainCheckout, prefix: target.redisPrefix })],
  ];
  const done: string[] = [];
  const failed: string[] = [];
  for (const [step, action] of steps) {
    try {
      // Sequential on purpose: the server must be gone before its database is dropped.
      // oxlint-disable-next-line no-await-in-loop
      done.push(await action());
    } catch (error) {
      failed.push(`${step}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failed.length > 0) {
    throw new Error(`Teardown of ${target.database} failed to ${failed.join("; ")}`);
  }
  deleteRecord({ mainCheckout, token: target.token });
  return done;
}
