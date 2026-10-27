// The bot's branch: where a fix starts (`startFix`, in friction-fix.yml's read-only `fix` job) and
// how it's pushed (`pushFix`, in `publish`, whose token can write). A fix stacks on the branch
// while its work is still wanted: an open PR, or a push whose PR never opened. Once the PR is
// closed (rejected) or merged, the next fix starts from dev and replaces the branch, but only at
// that PR's head: whatever else is on the branch is never overwritten.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PullRequest } from "./github.ts";
import { ReportError } from "./reports.ts";
import { changedPaths, FORBIDDEN, forbiddenMessage } from "./tools.ts";

const run = promisify(execFile);

/** Where the bundle's commit is fetched to in the publishing checkout. */
const FETCHED = "refs/friction/fix";

type Git = (args: string[]) => Promise<string>;

function gitIn(root: string): Git {
  return async (args) =>
    (await run("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 })).stdout.trim();
}

/** The bot branch's commit on origin, as this checkout last fetched it, or null. */
async function branchTip({ git, branch }: { git: Git; branch: string }): Promise<string | null> {
  try {
    return await git(["rev-parse", "-q", "--verify", `refs/remotes/origin/${branch}^{commit}`]);
  } catch {
    return null;
  }
}

type StartingPointArgs = {
  /** The bot branch's commit on origin, or null when there's no branch. */
  tip: string | null;
  /** Every PR from the bot branch. */
  pulls: PullRequest[];
};

/**
 * Whether the next fix goes on the bot branch or on the base branch (dev): on the bot branch
 * while a PR from it is open, or while no PR has had its tip (its PR failed to open); on dev once
 * the PR with its tip was closed (rejected) or merged.
 */
export function startingPoint({ tip, pulls }: StartingPointArgs): "branch" | "base" {
  if (tip === null) return "base";
  if (pulls.some(({ state }) => state === "open")) return "branch";
  return pulls.some(({ headSha }) => headSha === tip) ? "base" : "branch";
}

type BranchArgs = { root: string; branch: string; baseBranch: string; pulls: PullRequest[] };
type StartFixArgs = BranchArgs & { dryRun?: boolean };

/** Puts `root`, a full clone, on the bot branch at the commit the next fix starts from. */
export async function startFix({ root, branch, baseBranch, pulls, dryRun = false }: StartFixArgs) {
  const git = gitIn(root);
  const from = startingPoint({ tip: await branchTip({ git, branch }), pulls });
  const start = `refs/remotes/origin/${from === "branch" ? branch : baseBranch}`;
  if (!dryRun) await git(["checkout", "-q", "-B", branch, start]);
  return { from, commit: await git(["rev-parse", `${start}^{commit}`]) };
}

type PushFixArgs = BranchArgs & {
  /** The bundle `commitFix` wrote. */
  bundle: string;
  /** The commit the fix was made on, as `commitFix` reported it. */
  base: string;
  /** Check everything, push nothing. */
  dryRun?: boolean;
};

const mismatch = (message: string) => new ReportError({ code: "bundle_mismatch", message });

/**
 * Pushes the fix in `bundle` to the bot branch from `root`, a clone with push access. The fix job
 * ran code the model edited, so nothing it handed over is trusted: the bundle must hold one commit
 * whose parent is where `startingPoint` says a fix starts now, and change no path only the user
 * changes. It pushes without --force, except to replace a closed or merged PR's head, and then
 * only that head (--force-with-lease).
 */
export async function pushFix({
  root,
  bundle,
  base,
  branch,
  baseBranch,
  pulls,
  dryRun = false,
}: PushFixArgs): Promise<{ commit: string; stacked: boolean }> {
  const git = gitIn(root);
  await git(["fetch", "-q", "--prune", "origin"]);
  const tip = await branchTip({ git, branch });
  const from = startingPoint({ tip, pulls });
  if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(base)) throw mismatch(`${base} isn't a commit id.`);
  await git(["fetch", "-q", bundle, `+HEAD:${FETCHED}`]);
  const [commit, ...parents] = (await git(["rev-list", "--parents", "-n", "1", FETCHED])).split(
    " ",
  );
  if (parents.length !== 1 || parents[0] !== base) {
    throw mismatch(`The bundle isn't one commit on ${base}.`);
  }
  if (from === "branch" && base !== tip) {
    throw mismatch(`The fix was made on ${base}, not on ${branch}'s tip ${tip}.`);
  }
  if (from === "base") {
    try {
      await git(["merge-base", "--is-ancestor", base, `refs/remotes/origin/${baseBranch}`]);
    } catch {
      throw mismatch(`The fix was made on ${base}, which isn't on ${baseBranch}.`);
    }
  }
  const changed = await changedPaths({ root, args: [base, commit!] });
  const forbidden = changed.filter((path) => FORBIDDEN.test(path));
  if (forbidden.length > 0) {
    throw new ReportError({ code: "forbidden_paths", message: forbiddenMessage(forbidden) });
  }
  if (!dryRun) {
    const lease = from === "base" && tip ? [`--force-with-lease=refs/heads/${branch}:${tip}`] : [];
    try {
      await git(["push", "-q", ...lease, "origin", `${commit}:refs/heads/${branch}`]);
    } catch (error) {
      throw new ReportError({
        code: "push_rejected",
        message: `Pushing to ${branch} failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return { commit: commit!, stacked: from === "branch" };
}
