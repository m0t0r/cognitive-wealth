// Runs agent-browser, for `cw verify browser start` and `cw verify trace`. Node runs the CLIs that
// import this directly (type stripping), so relative imports keep their `.ts` extension.
import { execFileSync } from "node:child_process";
import { CliError } from "@repo/db/cli/cli-error";

/** How long one agent-browser command gets before it's refused. */
const TIMEOUT_MS = 30_000;

/** Runs agent-browser with `args` and returns its trimmed output; fails as `agent_browser_failed`. */
export function agentBrowser(args: string[]): string {
  try {
    return execFileSync("agent-browser", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: TIMEOUT_MS,
    }).trim();
  } catch (error) {
    const stderr =
      error instanceof Error && "stderr" in error && typeof error.stderr === "string"
        ? error.stderr.trim()
        : "";
    throw new CliError({
      code: "agent_browser_failed",
      message: `agent-browser ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`,
    });
  }
}
