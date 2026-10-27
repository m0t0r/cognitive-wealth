// What friction-fix.yml's `publish` job does with a fix, for `cw friction publish`: file the
// fixer's own friction, push the commit, open or update the bot's PR, and relabel each report from
// what happened to it. And `handBack`, for a run that stopped before `publish` could say.
import { z } from "zod";
import type { CommitOutcome } from "./commit.ts";
import type { GitHub, PullRequest } from "./github.ts";
import { MAX_FRICTION } from "./fix.ts";
import { FRICTION, ReportError, reportBody } from "./reports.ts";

const READY = "ready-for-agent";
const HUMAN = "ready-for-human";

const footer = (runUrl: string) =>
  `\n\n---\n_From \`.github/workflows/friction-fix.yml\` ([run](${runUrl}))._`;

const cut = (length: number) => z.string().transform((text) => text.slice(0, length));

/**
 * The fixer's answer, as `cw friction fix` printed it. It passed through a job that ran scripts
 * the model edited, so its shape and limits are checked again here.
 */
const Answer = z.object({
  fixed: z.array(z.object({ number: z.number(), summary: cut(4000) })),
  skipped: z.array(z.object({ number: z.number(), reason: cut(4000) })),
  friction: z
    .array(
      z.object({
        title: cut(200),
        what: cut(4000),
        cost: cut(4000),
        where: cut(4000),
        fix: cut(4000),
      }),
    )
    .transform((entries) => entries.slice(0, MAX_FRICTION)),
});
export type FixAnswer = z.output<typeof Answer>;

/** `value`'s fixed and skipped reports among `picked`, and at most 3 frictions. */
export function parseAnswer({ value, picked }: { value: unknown; picked: number[] }): FixAnswer {
  const parsed = Answer.safeParse(value);
  if (!parsed.success) {
    throw new ReportError({
      code: "invalid_answer",
      message: `The fixer's answer isn't { fixed, skipped, friction }: ${parsed.error.message}`,
    });
  }
  const isPicked = ({ number }: { number: number }) => picked.includes(number);
  return {
    fixed: parsed.data.fixed.filter(isPicked),
    skipped: parsed.data.skipped.filter(isPicked),
    friction: parsed.data.friction,
  };
}

const dropped = z.array(z.string());
const CommitOutcomeSchema = z.union([
  z.object({
    status: z.literal("committed"),
    commit: z.string(),
    base: z.string(),
    files: z.array(z.string()),
    dropped,
  }),
  z.object({ status: z.literal("would_commit"), files: z.array(z.string()), dropped }),
  z.object({ status: z.literal("no_changes"), dropped }),
  z.object({ status: z.literal("forbidden"), paths: z.array(z.string()), dropped }),
  z.object({ status: z.literal("duplicated"), path: z.string(), line: cut(200), dropped }),
  z.object({
    status: z.literal("checks_failed"),
    check: z.enum(["lint", "format", "format:check", "check-types", "test", "test:integration"]),
    output: cut(4000),
    dropped,
  }),
]);

/** `cw friction commit`'s outcome file, or null when it's missing or isn't one. */
export function parseCommitOutcome(value: unknown): CommitOutcome | null {
  const parsed = CommitOutcomeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export type PublishError = {
  step: "friction" | "push" | "pull_request" | "relabel";
  code: string;
  message: string;
};

function publishError({ step, error }: { step: PublishError["step"]; error: unknown }) {
  const code =
    error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code
      : "error";
  return { step, code, message: error instanceof Error ? error.message : String(error) };
}

type Labels = { add: string[]; remove: string[] };

export type ReportFate = {
  number: number;
  outcome: "fixed" | "handed_back";
  labels: Labels;
  comment: string;
};

export type PublishOutcome = {
  /** The fixer's own friction, filed as new reports; `number` is null on a dry run. */
  filed: { number: number | null; title: string }[];
  pushed: { commit: string; stacked: boolean } | null;
  /** The bot's PR; on a dry run, a new one has no number yet. */
  pullRequest: { number: number | null; url: string | null; created: boolean } | null;
  reports: ReportFate[];
  /** Every step that failed; the rest still ran. */
  errors: PublishError[];
};

type PublishFixArgs = {
  /** The reports this run picked; the answer counts only for them. */
  picked: number[];
  answer: FixAnswer;
  /** `commitFix`'s outcome, or null when the commit step left none. */
  commit: CommitOutcome | null;
  /** Pushes the bundled commit (`pushFix`), given the PRs from the bot branch. */
  push: (args: {
    pulls: PullRequest[];
    base: string;
  }) => Promise<{ commit: string; stacked: boolean }>;
  branch: string;
  baseBranch: string;
  runUrl: string;
  now?: Date;
  /** Push nothing, write nothing to GitHub; say what would be done. */
  dryRun: boolean;
};

/** Why a fixed report's fix didn't land, from the commit step's outcome; null once committed. */
function uncommitted(commit: CommitOutcome | null): string | null {
  if (commit === null) return "The fix wasn't committed: the commit step didn't finish.";
  switch (commit.status) {
    case "committed":
      return null;
    case "no_changes":
      return "The agent called this fixed but changed no file.";
    case "forbidden":
      return `The fix changed paths only the user changes (${commit.paths.join(", ")}), so it wasn't committed.`;
    case "checks_failed":
      return `The fix failed \`pnpm ${commit.check}\`, so it wasn't committed.`;
    case "duplicated":
      return `The fix repeated text already in \`${commit.path}\` ("${commit.line}"), so it wasn't committed.`;
    case "would_commit":
      return "The fix wasn't committed: the commit step was a dry run.";
    default: {
      const outcome: never = commit;
      throw new Error(`Unknown commit outcome ${JSON.stringify(outcome)}`);
    }
  }
}

type SectionArgs = { answer: FixAnswer; commit: CommitOutcome; runUrl: string; now: Date };

function prSection({ answer, commit, runUrl, now }: SectionArgs): string {
  const stamp = now.toISOString().slice(0, 16).replace("T", " ");
  const notCommitted =
    commit.dropped.length > 0
      ? [`- Not committed, since no summary names them: ${commit.dropped.join(", ")}`]
      : [];
  return [
    `### ${stamp} UTC, [run](${runUrl})`,
    "",
    ...answer.fixed.map(({ number, summary }) => `- Closes #${number}: ${summary}`),
    ...answer.skipped.map(
      ({ number, reason }) => `- Skipped #${number} (now \`${HUMAN}\`): ${reason}`,
    ),
    ...notCommitted,
  ].join("\n");
}

const PR_INTRO = `Friction reports fixed by \`.github/workflows/friction-fix.yml\` (Sonnet). Each run adds a commit and a section below while this PR is open. Closing it without merging rejects them: the next run starts again from \`dev\`.

GitHub holds this PR's checks until someone with write access approves them ("Approve workflows to run"), since the workflow's token pushed it. That click is the human gate before CI runs code the model wrote. Review it like any agent's PR. Reports it passed on are labelled \`${HUMAN}\`.`;

/**
 * Files the fixer's friction, pushes its commit, opens or updates the PR and relabels each picked
 * report, in that order. A step that fails is recorded in `errors` and the rest still run, so
 * every report ends labelled for what actually happened to it.
 */
export async function publishFix(
  github: GitHub,
  {
    picked,
    answer,
    commit,
    push,
    branch,
    baseBranch,
    runUrl,
    now = new Date(),
    dryRun,
  }: PublishFixArgs,
): Promise<PublishOutcome> {
  const errors: PublishError[] = [];
  const refs = picked.map((number) => `#${number}`).join(", ");

  // First, so a failure later can't lose it. Filed `ready-for-human`, not triaged: the text is
  // the model's, so a person reads it before it becomes the next run's instructions.
  const filed: PublishOutcome["filed"] = [];
  for (const { title, what, cost, where, fix } of answer.friction) {
    const body = reportBody({
      what: `${what}\n\n_Found by [friction-fix.yml](${runUrl}) (Sonnet) while fixing ${refs}._`,
      cost,
      where,
      fix,
    });
    try {
      const number = dryRun
        ? null
        : // oxlint-disable-next-line no-await-in-loop -- at most 3, filed in order
          (await github.create({ title, body, labels: [FRICTION, HUMAN] })).number;
      filed.push({ number, title });
    } catch (error) {
      errors.push(publishError({ step: "friction", error }));
    }
  }

  // Why the fixed reports' fix didn't land, or null once it's in a PR.
  let notLanded = uncommitted(commit);
  let pushed: PublishOutcome["pushed"] = null;
  let pullRequest: PublishOutcome["pullRequest"] = null;
  if (notLanded === null && commit?.status === "committed") {
    try {
      const pulls = await github.pullRequests({ head: branch, base: baseBranch });
      pushed = await push({ pulls, base: commit.base });
      const section = prSection({ answer, commit, runUrl, now });
      const open = pulls.find(({ state }) => state === "open");
      if (open) {
        // The commit is in the open PR already: a failed edit loses only its section.
        pullRequest = { number: open.number, url: open.url, created: false };
        if (!dryRun) {
          await github
            .editPullRequest({ number: open.number, body: `${open.body}\n\n${section}` })
            .catch((error: unknown) => errors.push(publishError({ step: "pull_request", error })));
        }
      } else if (dryRun) {
        pullRequest = { number: null, url: null, created: true };
      } else {
        try {
          const created = await github.createPullRequest({
            head: branch,
            base: baseBranch,
            title: "chore: address friction reports (automated)",
            body: `${PR_INTRO}\n\n${section}`,
          });
          pullRequest = { ...created, created: true };
        } catch (error) {
          const failed = publishError({ step: "pull_request", error });
          errors.push(failed);
          notLanded = `The fix is on \`${branch}\` (${pushed.commit.slice(0, 7)}), but its PR couldn't be opened: ${failed.message}. Open one from the branch; the next fix run will too.`;
        }
      }
    } catch (error) {
      const failed = publishError({ step: "push", error });
      errors.push(failed);
      notLanded = `Pushing the fix failed: ${failed.message}`;
    }
  }

  const prName =
    pullRequest === null || pullRequest.number === null ? "the bot's PR" : `#${pullRequest.number}`;
  const toHuman = (text: string) => ({
    outcome: "handed_back" as const,
    labels: { add: [HUMAN], remove: [READY] },
    comment: `${text}${footer(runUrl)}`,
  });
  const reports: ReportFate[] = picked.map((number) => {
    const skipped = answer.skipped.find((entry) => entry.number === number);
    const fixed = answer.fixed.find((entry) => entry.number === number);
    if (skipped) return { number, ...toHuman(`Passed on: ${skipped.reason}`) };
    if (!fixed) return { number, ...toHuman("The agent's answer didn't mention this report.") };
    if (notLanded !== null) {
      return { number, ...toHuman(`${notLanded}\n\nThe agent's summary: ${fixed.summary}`) };
    }
    return {
      number,
      outcome: "fixed",
      labels: { add: [], remove: [READY] },
      comment: `Fixed in ${prName}: ${fixed.summary}${footer(runUrl)}`,
    };
  });
  if (!dryRun) {
    for (const { number, labels, comment } of reports) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- a handful of reports, one at a time
        await github.editLabels({ number, ...labels });
        // oxlint-disable-next-line no-await-in-loop -- a handful of reports, one at a time
        await github.comment({ number, body: comment });
      } catch (error) {
        errors.push(publishError({ step: "relabel", error }));
      }
    }
  }
  return { filed, pushed, pullRequest, reports, errors };
}

type HandBackArgs = { numbers: number[]; runUrl: string; dryRun: boolean };

/**
 * Hands the reports a run picked to a human: only those still open and `ready-for-agent`, so no
 * report is picked again every run and none `publishFix` already labelled is touched. A report
 * whose fix landed but whose label didn't change is among them, so the default comment sends a
 * person to the run and the PR first.
 */
export async function handBack(github: GitHub, { numbers, runUrl, dryRun }: HandBackArgs) {
  const reason = `The automated fix run stopped before it labelled this report ([run](${runUrl})). Check the run and the bot's PR before labelling it again.`;
  const issues = await Promise.all(numbers.map((number) => github.view(number)));
  const waiting = issues.filter(({ state, labels }) => state === "open" && labels.includes(READY));
  if (!dryRun) {
    for (const { number } of waiting) {
      // oxlint-disable-next-line no-await-in-loop -- a handful of reports, one at a time
      await github.editLabels({ number, add: [HUMAN], remove: [READY] });
      // oxlint-disable-next-line no-await-in-loop -- a handful of reports, one at a time
      await github.comment({
        number,
        body: `${reason}${footer(runUrl)}`,
      });
    }
  }
  const handedBack = waiting.map(({ number }) => number);
  return { handedBack, left: numbers.filter((number) => !handedBack.includes(number)) };
}
