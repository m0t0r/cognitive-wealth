// Keeps the bot's open PR current with its base before a fix stacks on it, for `cw friction
// refresh` in friction-fix.yml's `prepare` job: GitHub rebases it on its side, as "Update branch →
// rebase" does, since the workflow's token can't push a branch that brings in dev's workflow
// changes. When GitHub won't, the run fixes nothing: the reports stay `ready-for-agent`, and the PR
// gets one comment per stuck head asking a person to update it, after which the next run goes on.
import type { GitHub } from "./github.ts";

export type RefreshOutcome =
  | { status: "no_pr" }
  | { status: "current"; pr: number }
  | { status: "would_rebase"; pr: number }
  | { status: "rebased"; pr: number; head: string }
  /** `asked`: whether this run commented on the PR (once per stuck head). */
  | { status: "stale"; pr: number; reason: string; asked: boolean };

type RefreshArgs = {
  /** The reports this run picked, which wait while the PR is stale. */
  picked: number[];
  branch: string;
  baseBranch: string;
  runUrl: string;
  dryRun: boolean;
  /** Waits between looks at a rebase GitHub may finish after accepting it; tests skip it. */
  wait?: (ms: number) => Promise<void>;
};

const LOOKS = 10;
const LOOK_EVERY_MS = 3000;

/** Marks the comment asking about head `sha`, so a stuck PR is asked once, not every run. */
const askedMarker = (sha: string) => `<!-- friction-bot:stale:${sha} -->`;

export async function refreshPullRequest(
  github: GitHub,
  {
    picked,
    branch,
    baseBranch,
    runUrl,
    dryRun,
    wait = (ms) => new Promise((done) => setTimeout(done, ms)),
  }: RefreshArgs,
): Promise<RefreshOutcome> {
  const openPr = async () =>
    (await github.pullRequests({ head: branch, base: baseBranch })).find(
      ({ state }) => state === "open",
    );
  const open = await openPr();
  if (!open) return { status: "no_pr" };
  if ((await github.behindBy({ base: baseBranch, head: branch })) === 0) {
    return { status: "current", pr: open.number };
  }
  if (dryRun) return { status: "would_rebase", pr: open.number };
  let reason: string;
  try {
    await github.rebasePullRequest({ id: open.id, expectedHeadSha: open.headSha });
    for (let look = 0; look < LOOKS; look++) {
      // oxlint-disable-next-line no-await-in-loop -- polling GitHub's rebase until it lands
      await wait(LOOK_EVERY_MS);
      // oxlint-disable-next-line no-await-in-loop -- polling GitHub's rebase until it lands
      const now = await openPr();
      if (
        now &&
        now.headSha !== open.headSha &&
        // oxlint-disable-next-line no-await-in-loop -- polling GitHub's rebase until it lands
        (await github.behindBy({ base: baseBranch, head: branch })) === 0
      ) {
        return { status: "rebased", pr: open.number, head: now.headSha };
      }
    }
    reason = `GitHub hadn't finished rebasing #${open.number} onto ${baseBranch} after ${(LOOKS * LOOK_EVERY_MS) / 1000} seconds`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reason = `GitHub couldn't rebase #${open.number} onto ${baseBranch}: ${message.replace(/\.$/, "")}`;
  }
  const marker = askedMarker(open.headSha);
  const asked = (await github.pullRequestComments(open.number)).some((body) =>
    body.includes(marker),
  );
  if (!asked) {
    const waiting = picked.map((number) => `#${number}`).join(", ");
    await github.commentOnPullRequest({
      number: open.number,
      body: `This PR is behind \`${baseBranch}\`, and ${reason}. A fix stacked on it would be checked against old code, so the friction bot fixes nothing until it's current: ${waiting} wait, still \`ready-for-agent\`. Click "Update branch" (or merge or close this PR); the next Friction fix run then picks them up: hourly, on the next triaged report, or now from Actions → Friction fix → Run workflow ([this run](${runUrl})).\n\n${marker}`,
    });
  }
  return { status: "stale", pr: open.number, reason, asked: !asked };
}
