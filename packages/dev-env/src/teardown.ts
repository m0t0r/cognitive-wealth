// Removes what a worktree's setup created: its `pnpm dev` server, its database and its Redis keys,
// then its record. Node runs the CLIs that import this directly (type stripping), so relative
// imports keep their `.ts` extension.
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { WorktreeResources } from "./names.ts";
import { deleteRecord } from "./registry.ts";
import { connectJanitor, dropDatabase, isRefused } from "./services.ts";

/** A running `pnpm dev`: the `dev.ts` wrapper and, when known, `next dev`'s process group. */
export type Server = { pid: number; group?: number | undefined };

/** What to remove: the names, and the `pnpm dev` if one is recorded or found running. */
export type TeardownTarget = WorktreeResources & { server?: Server | undefined };

const STOP_TIMEOUT_MS = 10_000;
const WRAPPER = "dev-env/src/cli/dev.ts";

/**
 * Every running `pnpm dev` wrapper with its working directory (`<checkout>/apps/web`, where pnpm
 * runs `dev:app`) and `next dev`'s group (its child). Found from the process table, so a server
 * whose record was lost is still found.
 */
export function runningServers(): Array<Server & { cwd: string }> {
  const table = execFileSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" });
  const rows = table.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return match
      ? [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] ?? "" }]
      : [];
  });
  return rows
    // The node process itself, not the `sh -c` pnpm runs it in, whose command line names it too.
    .filter(({ command }) => /^\S*\bnode\s/.test(command) && command.includes(WRAPPER))
    .flatMap(({ pid }) => {
      const cwd = cwdOf(pid);
      const next = rows.find((row) => row.ppid === pid && /\bnext\b/.test(row.command));
      return cwd ? [{ pid, group: next?.pid, cwd }] : [];
    });
}

function cwdOf(pid: number): string | undefined {
  try {
    const out = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return /^n(.+)$/m.exec(out)?.[1];
  } catch {
    return undefined;
  }
}

/** The running `pnpm dev` of the checkout at `path`, if any. */
export function runningServerOf(path: string): Server | undefined {
  return runningServers().find(({ cwd }) => cwd === join(path, "apps/web"));
}

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

async function waitForExit({ pid, deadline }: { pid: number; deadline: number }) {
  if (!alive(pid)) return true;
  if (Date.now() > deadline) return false;
  await sleep(100);
  return waitForExit({ pid, deadline });
}

/** SIGTERM, then SIGKILL after a grace period. Returns false if it still runs. */
async function stop(pid: number) {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return true;
  }
  if (await waitForExit({ pid, deadline: Date.now() + STOP_TIMEOUT_MS })) return true;
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return true;
  }
  return waitForExit({ pid, deadline: Date.now() + STOP_TIMEOUT_MS });
}

/**
 * Stops the worktree's `pnpm dev`: the wrapper first, which stops `next dev`'s group and exits (so
 * portless drops the route), then the group itself in case the wrapper died without doing that.
 * A pid is only signalled while its command line is still the one setup started, so a pid the
 * system has since reused is left alone.
 */
export async function stopServer(server: Server): Promise<string> {
  const stopped: string[] = [];
  if (commandOf(server.pid)?.includes(WRAPPER)) {
    if (!(await stop(server.pid))) throw new Error(`pnpm dev (pid ${server.pid}) won't exit`);
    stopped.push(`pnpm dev (pid ${server.pid})`);
  }
  const { group } = server;
  if (group !== undefined && alive(-group) && /\bnext\b/.test(commandOf(group) ?? "next")) {
    if (!(await stop(-group))) throw new Error(`next dev (group ${group}) won't exit`);
    stopped.push(`next dev (group ${group})`);
  }
  return stopped.length > 0 ? `stopped ${stopped.join(" and ")}` : "no pnpm dev was running";
}

async function removeDatabase({
  mainCheckout,
  database,
}: {
  mainCheckout: string;
  database: string;
}) {
  try {
    const dropped = await dropDatabase({ mainCheckout, database });
    return dropped ? `dropped database ${database}` : `no database ${database}`;
  } catch (error) {
    // The verification Postgres keeps its data in memory: if it isn't running, nothing is left.
    if (isRefused(error)) return "the verification Postgres isn't running, so no database is left";
    throw error;
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
      async () => (target.server ? stopServer(target.server) : "no pnpm dev was running"),
    ],
    ["drop the database", () => removeDatabase({ mainCheckout, database: target.database })],
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
