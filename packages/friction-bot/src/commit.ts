// The fixer's commit gate, for `cw friction commit` in friction-fix.yml's read-only `fix` job: it
// stages what the fixer changed, drops new files no fixed report names, refuses paths only the user
// changes, runs the checks CI runs, and commits what passes as one commit, bundled for `publish`.
import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { type Check, type CheckResult, FORBIDDEN } from "./tools.ts";

const run = promisify(execFile);

/** The checks a fix must pass, in order: CI's, and the integration tests (the runner has Docker). */
export const COMMIT_CHECKS = [
  "lint",
  "format:check",
  "check-types",
  "test",
  "test:integration",
] as const satisfies readonly Check[];

/** The bot's commits are authored as the workflow token's user. */
const AUTHOR = [
  "-c",
  "user.name=github-actions[bot]",
  "-c",
  "user.email=41898282+github-actions[bot]@users.noreply.github.com",
];

export type CommitOutcome =
  | { status: "committed"; commit: string; base: string; files: string[]; dropped: string[] }
  | { status: "would_commit"; files: string[]; dropped: string[] }
  | { status: "no_changes"; dropped: string[] }
  | { status: "forbidden"; paths: string[]; dropped: string[] }
  | { status: "checks_failed"; check: Check; output: string; dropped: string[] };

type CommitFixArgs = {
  /** The checkout the fixer edited, on the branch the commit goes on. */
  root: string;
  /** The reports the fixer says it fixed; only their summaries can name a new file. */
  fixed: { number: number; summary: string }[];
  runCheck: (check: Check) => Promise<CheckResult>;
  /** Where the bundle of the one new commit goes. */
  bundle: string;
  /** List what would be committed; delete, check and commit nothing. */
  dryRun?: boolean;
};

const lines = (text: string) => text.split("\n").filter(Boolean);

export async function commitFix({
  root,
  fixed,
  runCheck,
  bundle,
  dryRun = false,
}: CommitFixArgs): Promise<CommitOutcome> {
  const git = async (args: string[]) =>
    (await run("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 })).stdout.trim();
  await git(["add", "-A"]);
  // Both sides of a rename, so moving a file out of a forbidden path is caught too.
  const staged = lines(await git(["diff", "--cached", "--name-only", "--no-renames"]));
  const added = lines(
    await git(["diff", "--cached", "--name-only", "--no-renames", "--diff-filter=A"]),
  );
  // A scratch file the fixer left (#257's tmp-jsonb test): no summary names it.
  const dropped = added.filter((path) => !fixed.some(({ summary }) => summary.includes(path)));
  const files = staged.filter((path) => !dropped.includes(path));
  const forbidden = files.filter((path) => FORBIDDEN.test(path));
  if (dryRun) {
    await git(["reset", "-q"]);
    if (forbidden.length > 0) return { status: "forbidden", paths: forbidden, dropped };
    return { status: "would_commit", files, dropped };
  }
  if (dropped.length > 0) {
    await git(["rm", "-q", "--cached", "--", ...dropped]);
    await Promise.all(dropped.map((path) => rm(join(root, path))));
  }
  // A change no fixed report accounts for isn't committed.
  if (files.length === 0 || fixed.length === 0) return { status: "no_changes", dropped };
  if (forbidden.length > 0) return { status: "forbidden", paths: forbidden, dropped };
  for (const check of COMMIT_CHECKS) {
    // oxlint-disable-next-line no-await-in-loop -- in order, stopping at the first failure
    const { exitCode, output } = await runCheck(check);
    if (exitCode !== 0) return { status: "checks_failed", check, output, dropped };
  }
  const refs = fixed.map(({ number }) => `#${number}`).join(", ");
  await git([...AUTHOR, "commit", "-q", "-m", `chore: address friction reports (${refs})`]);
  const [commit, base] = lines(await git(["rev-parse", "HEAD", "HEAD~1"]));
  await git(["bundle", "create", "-q", bundle, `${base}..HEAD`]);
  return { status: "committed", commit: commit!, base: base!, files, dropped };
}
