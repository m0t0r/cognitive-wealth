// Stopping processes this package's setup (or the verifier-web skill) started, and only those: a
// pid is checked against its command line first, since the system may have reused it. Node runs
// the CLIs that import this directly (type stripping), so relative imports keep their `.ts`
// extension.
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const STOP_TIMEOUT_MS = 10_000;

/** The command line of `pid`, or undefined when no such process is running. */
export function commandOf(pid: number): string | undefined {
  try {
    return execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

export function alive(pid: number) {
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
export async function stop(pid: number) {
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
