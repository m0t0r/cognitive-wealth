// `cw verify browser start`: one headless Chrome on 127.0.0.1:9222 that both agent-browser and the
// chrome-devtools MCP drive (the MCP is configured with `--browserUrl http://127.0.0.1:9222`),
// signed in as a seeded user. Launching agent-browser with `--args "--remote-debugging-port=9222"`
// hangs its daemon, so Chrome starts first and agent-browser connects to it. Its pid, profile and
// holder (a checkout's token and path) go to the main checkout's `.dev/verify/chrome.*`, so
// `cw verify browser stop` (`releaseChrome`) stops that one process and nothing else.
//
// One Chrome serves every worktree, and they can't share it: agent-browser sessions connected to
// one Chrome drive the same tab with the same cookies, and Chrome traces one page at a time. So the
// holder file is a lock. Another checkout's Chrome is refused while that checkout is alive; once
// it's gone, this checkout takes over with a fresh Chrome. Node runs the CLIs that import this
// directly (type stripping), so relative imports keep their `.ts` extension.
import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { CliError } from "@repo/db/cli/cli-error";
import { type Checkout, liveWorktrees } from "./checkout.ts";
import { verifyResources } from "./names.ts";
import { commandOf, listenerOn, stop } from "./processes.ts";
import { chromeFiles, stopChrome, verifyDir } from "./verify.ts";

const PORT = 9222;

/** What starting the browser reaches outside itself for; a test hands in its own. */
export type BrowserSystem = {
  listenerOn: (port: number) => number | undefined;
  commandOf: (pid: number) => string | undefined;
  /** The roots of the main checkout and of every worktree git still lists. */
  liveCheckouts: (mainCheckout: string) => string[];
  stopChrome: typeof stopChrome;
  /** Starts a headless Chrome on 9222 with a new profile, once it answers there. */
  launchChrome: () => Promise<{ pid: number; profile: string }>;
  agentBrowser: (args: string[]) => void;
  sleep: (ms: number) => Promise<void>;
};

/** agent-browser's newest Chrome for Testing, which `agent-browser install` downloads. */
function chromeBinary(): string {
  const browsers = join(homedir(), ".agent-browser/browsers");
  const [newest] = (existsSync(browsers) ? readdirSync(browsers) : [])
    .filter((name) => name.startsWith("chrome-"))
    .toSorted((a, b) => b.localeCompare(a, "en", { numeric: true }));
  const binary =
    newest &&
    join(
      browsers,
      newest,
      "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    );
  if (!binary || !existsSync(binary)) {
    throw new CliError({
      code: "no_chrome",
      message: `No Chrome for Testing in ${browsers}; install it with agent-browser install.`,
    });
  }
  return binary;
}

async function answers(): Promise<boolean> {
  try {
    return (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok;
  } catch {
    return false;
  }
}

async function launchChrome() {
  const profile = mkdtempSync(join(tmpdir(), "cw-chrome-"));
  const child = spawn(
    chromeBinary(),
    [
      `--headless=new`,
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "about:blank",
    ],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  const { pid } = child;
  if (pid === undefined)
    throw new CliError({ code: "chrome_failed", message: "Chrome didn't start." });
  for (let tries = 20; tries > 0; tries -= 1) {
    // oxlint-disable-next-line no-await-in-loop -- one try at a time, until Chrome answers
    if (await answers()) return { pid, profile };
    // oxlint-disable-next-line no-await-in-loop -- the wait between tries
    await sleep(500);
  }
  await stop(pid);
  throw new CliError({
    code: "chrome_failed",
    message: `Chrome (pid ${pid}) didn't come up on ${PORT}.`,
  });
}

function agentBrowser(args: string[]) {
  try {
    execFileSync("agent-browser", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new CliError({
      code: "agent_browser_failed",
      message: `agent-browser ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`,
    });
  }
}

export const defaultBrowserSystem: BrowserSystem = {
  listenerOn,
  commandOf,
  liveCheckouts: (mainCheckout) => [
    mainCheckout,
    ...liveWorktrees(mainCheckout).map(({ path }) => path),
  ],
  stopChrome,
  launchChrome,
  agentBrowser,
  sleep: (ms) => sleep(ms),
};

export type StartBrowserArgs = {
  checkout: Checkout;
  email: string;
  /** The app's URL, opened once signed in. */
  app: string;
  /** The client IP every request claims (x-forwarded-for), the persona's rate-limit bucket. */
  ip: string;
  /** The agent-browser session; this checkout's own by default. */
  session?: string | undefined;
  system?: BrowserSystem | undefined;
};

export type StartedBrowser = {
  session: string;
  /** The session file loaded. */
  statePath: string;
  chrome: { pid: number; started: boolean; tookOverFrom?: string };
};

/**
 * The session file `cw dev sign-in` saved for `email`: this checkout's first, since it saves to the
 * checkout it runs from and one in the main checkout may belong to another task's server.
 */
export function sessionFileOf({ checkout, email }: { checkout: Checkout; email: string }) {
  return [checkout.top, checkout.mainCheckout]
    .map((root) => join(root, ".dev/auth", `${email}.json`))
    .find((file) => existsSync(file));
}

const LOCK_TRIES = 60;
const LOCK_WAIT_MS = 500;

/**
 * Runs `work` holding the main checkout's `chrome.starting` lock: checking the holder and starting
 * Chrome is one step, since two worktrees starting at once would both find 9222 free. `mkdir` is
 * atomic, so the directory is the mutex.
 */
async function withLock<T>({
  mainCheckout,
  system,
  work,
}: {
  mainCheckout: string;
  system: BrowserSystem;
  work: () => Promise<T>;
}): Promise<T> {
  const lock = join(verifyDir(mainCheckout), "chrome.starting");
  mkdirSync(verifyDir(mainCheckout), { recursive: true });
  let held = false;
  for (let tries = LOCK_TRIES; tries > 0 && !held; tries -= 1) {
    try {
      mkdirSync(lock);
      held = true;
    } catch {
      // oxlint-disable-next-line no-await-in-loop -- waiting for the other start, one try at a time
      await system.sleep(LOCK_WAIT_MS);
    }
  }
  if (!held) {
    throw new CliError({
      code: "chrome_starting",
      message:
        `Another start has been starting Chrome for ${(LOCK_TRIES * LOCK_WAIT_MS) / 1000} s. ` +
        `If none is running, remove ${lock} and rerun.`,
    });
  }
  try {
    return await work();
  } finally {
    rmdirSync(lock);
  }
}

const read = (file: string) => (existsSync(file) ? readFileSync(file, "utf8").trim() : "");

export async function startBrowser({
  checkout,
  email,
  app,
  ip,
  session: chosen,
  system = defaultBrowserSystem,
}: StartBrowserArgs): Promise<StartedBrowser> {
  const { mainCheckout, top, worktreeId } = checkout;
  const { token, session: own } = verifyResources(worktreeId);
  const session = chosen ?? own;
  const statePath = sessionFileOf({ checkout, email });
  if (!statePath) {
    throw new CliError({
      code: "no_session",
      message: `No session file for ${email} in ${join(top, ".dev/auth")} or the main checkout's; sign in first.`,
    });
  }
  const files = chromeFiles(mainCheckout);

  return withLock({
    mainCheckout,
    system,
    work: async () => {
      let tookOverFrom: string | undefined;
      let chrome: { pid: number; started: boolean } | undefined;
      const listener = system.listenerOn(PORT);
      if (listener !== undefined) {
        // Only the Chrome this command started, by its recorded pid: anything else on 9222 (often an
        // everyday Chrome with remote debugging on) would put the trace in a personal browser.
        if (String(listener) !== read(files.pid)) {
          throw new CliError({
            code: "port_9222_taken",
            message:
              `Port ${PORT} is held by another process (pid ${listener}: ` +
              `${(system.commandOf(listener) ?? "gone").slice(0, 120)}). Ask the user to quit it, then rerun.`,
          });
        }
        const [holder, holderPath] = read(files.owner).split("\n");
        if (!holder || !holderPath) {
          throw new CliError({
            code: "chrome_held",
            message:
              `The Chrome on ${PORT} (pid ${listener}) has no recorded holder: start-browser.sh, ` +
              "the script before this command, started it, and someone may still be tracing in it. " +
              "Stop it with pnpm cw verify browser stop from that checkout, or ask the user.",
          });
        }
        if (holder === token) {
          chrome = { pid: listener, started: false };
        } else if (system.liveCheckouts(mainCheckout).includes(holderPath)) {
          throw new CliError({
            code: "chrome_held",
            message:
              `The shared Chrome on ${PORT} is in use by ${holderPath}. Wait until its verification ` +
              "is done (its pnpm cw verify browser stop frees it), or ask the user.",
          });
        } else {
          // Its holder is gone: start over, so none of its cookies (shared by every localhost port)
          // stay.
          await system.stopChrome(mainCheckout);
          tookOverFrom = holderPath;
        }
      }
      if (!chrome) {
        const { pid, profile } = await system.launchChrome();
        writeFileSync(files.pid, `${pid}\n`);
        writeFileSync(files.profile, `${profile}\n`);
        writeFileSync(files.owner, `${token}\n${top}\n`);
        chrome = { pid, started: true };
      }

      system.agentBrowser(["--session", session, "connect", String(PORT)]);
      system.agentBrowser(["--session", session, "state", "load", statePath]);
      system.agentBrowser([
        "--session",
        session,
        "--headers",
        JSON.stringify({ "x-forwarded-for": ip }),
        "open",
        app,
      ]);
      return { session, statePath, chrome: { ...chrome, ...(tookOverFrom && { tookOverFrom }) } };
    },
  });
}
