// What the verifier-web skill leaves behind for one checkout, and how teardown removes it: the
// production servers its `start-app.sh` runs (pidfiles under the main checkout's
// `.dev/verify/<token>/`, which outlive the worktree), the `--ref` checkouts it builds
// (`.dev/worktrees/<token>-<sha>`) and the shared headless Chrome while this checkout holds it
// (`.dev/verify/chrome.*`), and the Compose project its `compose.sh` runs. Its databases are dropped with the worktree's own (`teardown.ts`).
// Node runs the CLIs that import this directly (type stripping), so relative imports keep their
// `.ts` extension.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tokenOfRefCheckout } from "./names.ts";
import { commandOf, stop } from "./processes.ts";

export const verifyDir = (mainCheckout: string) => join(mainCheckout, ".dev/verify");
export const refCheckoutsDir = (mainCheckout: string) => join(mainCheckout, ".dev/worktrees");

/** Where `start-app.sh` keeps a checkout's server pidfiles and logs. */
export const stateDirOf = ({ mainCheckout, token }: { mainCheckout: string; token: string }) =>
  join(verifyDir(mainCheckout), token);

/** The names in `dir`, or none when it doesn't exist. */
export function namesIn(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir) : [];
}

/** A standalone web server, by the title Next gives it once started or by the script it runs. */
function isWebServer(command: string | undefined) {
  return (
    command !== undefined &&
    (command.startsWith("next-server ") ||
      /^node\b.*\/\.next\/standalone\/apps\/web\/server\.js/.test(command))
  );
}

/** Stops the servers `start-app.sh` recorded for `token`, then removes their pidfiles and logs. */
export async function stopVerifyServers({
  mainCheckout,
  token,
}: {
  mainCheckout: string;
  token: string;
}): Promise<string> {
  const dir = stateDirOf({ mainCheckout, token });
  const stopped: string[] = [];
  for (const name of namesIn(dir).filter((file) => file.endsWith(".pid"))) {
    const pid = Number(readFileSync(join(dir, name), "utf8").trim());
    if (Number.isInteger(pid) && pid > 0 && isWebServer(commandOf(pid))) {
      // oxlint-disable-next-line no-await-in-loop -- at most two, one at a time
      if (!(await stop(pid))) throw new Error(`verification server (pid ${pid}) won't exit`);
      stopped.push(`pid ${pid}`);
    }
  }
  rmSync(dir, { recursive: true, force: true });
  return stopped.length > 0
    ? `stopped the verification server ${stopped.join(" and ")}`
    : "no verification server was running";
}

/** Removes the `--ref` checkouts `start-app.sh` built for `token`. */
export function removeRefCheckouts({
  mainCheckout,
  token,
}: {
  mainCheckout: string;
  token: string;
}): string {
  const dir = refCheckoutsDir(mainCheckout);
  const checkouts = namesIn(dir).filter((name) => tokenOfRefCheckout(name) === token);
  for (const name of checkouts) {
    execFileSync("git", ["-C", mainCheckout, "worktree", "remove", "--force", join(dir, name)], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  return checkouts.length > 0
    ? `removed the --ref checkouts ${checkouts.join(", ")}`
    : "no --ref checkout";
}

/** Every Compose project's name, stopped ones included; none when Docker isn't running. */
export function composeProjectNames(): string[] {
  try {
    const out = execFileSync("docker", ["compose", "ls", "--all", "--format", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const projects: unknown = JSON.parse(out);
    if (!Array.isArray(projects)) return [];
    return projects.flatMap((project: unknown) =>
      typeof project === "object" &&
      project !== null &&
      "Name" in project &&
      typeof project.Name === "string"
        ? [project.Name]
        : [],
    );
  } catch {
    return [];
  }
}

/**
 * Removes `compose.sh`'s Compose project for `token`, volumes included: they hold only that
 * checkout's throwaway data. Compose finds the containers by the project's label, so no file is
 * needed, and a worktree that's gone still has its project removed.
 */
export function removeComposeProject(project: string): string {
  if (!composeProjectNames().includes(project)) return "no Compose project";
  execFileSync("docker", ["compose", "-p", project, "down", "--volumes", "--remove-orphans"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  return `removed the Compose project ${project}`;
}

/** The shared Chrome's files: its pid, its throwaway profile and the checkout holding it. */
export const chromeFiles = (mainCheckout: string) => ({
  pid: join(verifyDir(mainCheckout), "chrome.pid"),
  profile: join(verifyDir(mainCheckout), "chrome.profile"),
  owner: join(verifyDir(mainCheckout), "chrome.owner"),
});

const read = (file: string) => (existsSync(file) ? readFileSync(file, "utf8").trim() : "");

/**
 * Closes `session` and, when `token` holds the shared Chrome (`chrome.owner`'s first line), stops
 * that Chrome as `stop-browser.sh` does: only while its command line is still the headless one with
 * the recorded profile.
 */
export async function releaseChrome({
  mainCheckout,
  token,
  session,
}: {
  mainCheckout: string;
  token: string;
  session: string;
}): Promise<string> {
  try {
    execFileSync("agent-browser", ["--session", session, "close"], { stdio: "ignore" });
  } catch {
    // No such session, or no agent-browser here: nothing to close.
  }
  const files = chromeFiles(mainCheckout);
  if (read(files.owner).split("\n")[0] !== token) return "didn't hold the shared Chrome";
  const pid = Number(read(files.pid));
  const profile = read(files.profile);
  const command = pid > 0 ? commandOf(pid) : undefined;
  let stopped = false;
  if (
    command?.includes("--headless=new") &&
    profile &&
    command.includes(`--user-data-dir=${profile}`)
  ) {
    if (!(await stop(pid))) throw new Error(`the shared Chrome (pid ${pid}) won't exit`);
    stopped = true;
  }
  // Only a profile under the temp directory, where `start-browser.sh` makes it, is deleted.
  if (profile && [tmpdir(), "/tmp/", "/var/folders/"].some((root) => profile.startsWith(root))) {
    rmSync(profile, { recursive: true, force: true });
  }
  for (const file of Object.values(files)) rmSync(file, { force: true });
  return stopped ? `stopped the shared Chrome (pid ${pid})` : "released the shared Chrome";
}
