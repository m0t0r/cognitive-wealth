// Running commands, and stopping processes this package's setup (or `cw verify`) started, and only
// those: a pid is checked against its command line first, since the system may have reused it.
// Node runs the CLIs that import this directly (type stripping), so relative imports keep their
// `.ts` extension.
import { execFileSync, spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { CliError } from "@repo/db/cli/cli-error";

export type RunResult = { status: number | null; stdout: string; stderr: string };

type RunCommandArgs = {
  command: string;
  args: string[];
  cwd?: string | undefined;
  env?: Record<string, string> | undefined;
};

/** `command <args>` to its end, with `env` on top of this process's environment, captured. */
export function runCommand({ command, args, cwd, env }: RunCommandArgs): RunResult {
  const { status, stdout, stderr } = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status, stdout, stderr };
}

/** The end of a failed step's output, enough to see why without flooding the error. */
export const tail = (text: string) => text.trim().split("\n").slice(-20).join("\n");

/** `result`'s stdout, or a refusal `code` saying `what` failed, with its output's end. */
export function checked({ result, code, what }: { result: RunResult; code: string; what: string }) {
  if (result.status !== 0) {
    throw new CliError({
      code,
      message: `${what} failed:\n${tail(result.stderr || result.stdout)}`,
    });
  }
  return result.stdout.trim();
}

const STOP_TIMEOUT_MS = 10_000;

/** The command line of `pid`, or undefined when no such process is running. */
export function commandOf(pid: number): string | undefined {
  try {
    return execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

/** The pid listening on TCP `port`, or undefined when nothing does. */
export function listenerOn(port: number): number | undefined {
  try {
    const out = execFileSync("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const pid = Number(out.split("\n")[0]);
    return pid > 0 ? pid : undefined;
  } catch {
    // lsof exits 1 when nothing matches.
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
