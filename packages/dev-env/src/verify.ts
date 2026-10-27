// What the verifier-web skill leaves behind for one checkout, and how `cw verify stop`,
// `cw verify browser stop` and teardown remove it: the production servers `cw verify start`
// runs (pidfiles under the main checkout's `.dev/verify/<token>/`, which outlive the worktree),
// the `--ref` checkouts it builds (`.dev/worktrees/<token>-<sha>`) and the shared headless Chrome
// while this checkout holds it (`.dev/verify/chrome.*`), and the Compose project
// `cw verify compose up` runs. Its databases are dropped with the worktree's own (`teardown.ts`).
// Node runs the CLIs that import this directly (type stripping), so relative imports keep their
// `.ts` extension.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { commandOf, stop } from "./processes.ts";

export const verifyDir = (mainCheckout: string) => join(mainCheckout, ".dev/verify");
/** A verification server's role: `head` serves the working tree, `ref` a `--ref` build. */
export type ServerRole = "head" | "ref";

export const refCheckoutsDir = (mainCheckout: string) => join(mainCheckout, ".dev/worktrees");

/** Where `cw verify start` keeps a checkout's server pidfiles and logs. */
export const stateDirOf = ({ mainCheckout, token }: { mainCheckout: string; token: string }) =>
  join(verifyDir(mainCheckout), token);

/** The names in `dir`, or none when it doesn't exist. */
export function namesIn(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir) : [];
}

/** The pidfile and log of `token`'s server for `role`. */
export function serverFilesOf({
  mainCheckout,
  token,
  role,
}: {
  mainCheckout: string;
  token: string;
  role: ServerRole;
}) {
  const dir = stateDirOf({ mainCheckout, token });
  return { pid: join(dir, `server-${role}.pid`), log: join(dir, `server-${role}.log`) };
}

/** A standalone web server, by the title Next gives it once started or by the script it runs. */
export function isWebServer(command: string | undefined) {
  return (
    command !== undefined &&
    (command.startsWith("next-server ") ||
      /^node\b.*\/\.next\/standalone\/apps\/web\/server\.js/.test(command))
  );
}

/**
 * The servers `cw verify start` recorded for `token` that still run: a recorded pid whose process
 * is now something else (the system reused it) isn't one.
 */
export function verifyServersOf({
  mainCheckout,
  token,
}: {
  mainCheckout: string;
  token: string;
}): number[] {
  const dir = stateDirOf({ mainCheckout, token });
  return namesIn(dir)
    .filter((file) => file.endsWith(".pid"))
    .map((name) => Number(readFileSync(join(dir, name), "utf8").trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && isWebServer(commandOf(pid)));
}

/** Stops the servers `cw verify start` recorded for `token`, then removes their pidfiles, logs. */
export async function stopVerifyServers({
  mainCheckout,
  token,
}: {
  mainCheckout: string;
  token: string;
}): Promise<string> {
  const stopped: string[] = [];
  for (const pid of verifyServersOf({ mainCheckout, token })) {
    // oxlint-disable-next-line no-await-in-loop -- at most two, one at a time
    if (!(await stop(pid))) throw new Error(`verification server (pid ${pid}) won't exit`);
    stopped.push(`pid ${pid}`);
  }
  rmSync(stateDirOf({ mainCheckout, token }), { recursive: true, force: true });
  return stopped.length > 0
    ? `stopped the verification server ${stopped.join(" and ")}`
    : "no verification server was running";
}

/**
 * The `--ref` checkouts `cw verify start` built for `token` (`<token>-<sha>`), as paths. Matched on
 * the token itself, not `tokenOfRefCheckout`, which knows only worktrees' tokens: the main
 * checkout's `main-<sha>` is this checkout's too.
 */
export function refCheckoutsOf({
  mainCheckout,
  token,
}: {
  mainCheckout: string;
  token: string;
}): string[] {
  const dir = refCheckoutsDir(mainCheckout);
  return namesIn(dir)
    .filter(
      (name) => name.startsWith(`${token}-`) && /^[0-9a-f]+$/.test(name.slice(token.length + 1)),
    )
    .map((name) => join(dir, name));
}

/** Removes the `--ref` checkouts `cw verify start` built for `token`. */
export function removeRefCheckouts({
  mainCheckout,
  token,
}: {
  mainCheckout: string;
  token: string;
}): string {
  const checkouts = refCheckoutsOf({ mainCheckout, token });
  for (const checkout of checkouts) {
    execFileSync("git", ["-C", mainCheckout, "worktree", "remove", "--force", checkout], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  return checkouts.length > 0
    ? `removed the --ref checkouts ${checkouts.map((checkout) => basename(checkout)).join(", ")}`
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
 * Removes `cw verify compose up`'s Compose project for `token`, volumes included: they hold only
 * that checkout's throwaway data. Compose finds the containers by the project's label, so no file is
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

/** The token of the checkout holding the shared Chrome (`chrome.owner`'s first line), if any. */
export function chromeHolder(mainCheckout: string): string | undefined {
  return read(chromeFiles(mainCheckout).owner).split("\n")[0] || undefined;
}

/** Closes `session` and, when `token` holds the shared Chrome, stops it (`stopChrome`). */
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
  if (chromeHolder(mainCheckout) !== token) return "didn't hold the shared Chrome";
  return stopChrome(mainCheckout);
}

/**
 * Stops the shared Chrome its files record, whoever holds it, and removes them with its profile:
 * the process only while its command line is still the headless one with the recorded profile,
 * since the system may have reused the pid.
 */
export async function stopChrome(mainCheckout: string): Promise<string> {
  const files = chromeFiles(mainCheckout);
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
  // Only a profile under the temp directory, where `cw verify browser start` makes it, is deleted.
  if (profile && [tmpdir(), "/tmp/", "/var/folders/"].some((root) => profile.startsWith(root))) {
    rmSync(profile, { recursive: true, force: true });
  }
  for (const file of Object.values(files)) rmSync(file, { force: true });
  return stopped ? `stopped the shared Chrome (pid ${pid})` : "released the shared Chrome";
}
