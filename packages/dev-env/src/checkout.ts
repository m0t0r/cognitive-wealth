// Where a command runs: the main checkout or a linked worktree, and which worktrees are alive.
// Node runs the CLIs that import this directly (type stripping), so relative imports keep their
// `.ts` extension.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export type Checkout = {
  /** The checkout's root. */
  top: string;
  /** The main checkout's root, which holds `.secrets/`, Compose and the shared `.dev/`. */
  mainCheckout: string;
  /** The worktree's id (its directory under `.git/worktrees/`); undefined in the main checkout. */
  worktreeId: string | undefined;
};

function git(dir: string, args: string[]) {
  return execFileSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function checkoutAt(dir: string): Checkout {
  const top = git(dir, ["rev-parse", "--show-toplevel"]);
  const common = git(dir, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return { top, mainCheckout: dirname(common), worktreeId: worktreeIdAt(top) };
}

/**
 * The id of the linked worktree rooted at `path`, from its `.git` file (`gitdir: …/worktrees/<id>`),
 * or undefined when `path` is the main checkout, isn't a checkout or no longer exists.
 */
export function worktreeIdAt(path: string): string | undefined {
  const dotGit = join(path, ".git");
  if (!existsSync(dotGit) || !statSync(dotGit).isFile()) return undefined;
  const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"))?.[1]?.trim();
  if (!gitdir || basename(dirname(resolve(path, gitdir))) !== "worktrees") return undefined;
  return basename(gitdir);
}

/** The ids of the linked worktrees git still knows and that still exist on disk. */
export function liveWorktreeIds(mainCheckout: string): Set<string> {
  const blocks = git(mainCheckout, ["worktree", "list", "--porcelain"]).split(/\n\n+/);
  const ids = new Set<string>();
  for (const block of blocks) {
    const path = /^worktree (.+)$/m.exec(block)?.[1];
    if (!path || /^prunable\b/m.test(block)) continue;
    const id = worktreeIdAt(path);
    if (id) ids.add(id);
  }
  return ids;
}
