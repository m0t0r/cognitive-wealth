// Friction reports on GitHub (docs/agents/friction.md): filing one, triaging one with a decision
// from `triage.ts`, and gathering a batch for `fix.ts`. `cw friction …` (`@repo/cli`) runs these;
// the rules and their tests live here.
import type { Comment, GitHub, Issue, IssueSummary } from "./github.ts";
import type { Triage, TriagePromptArgs } from "./triage.ts";

export const FRICTION = "friction";
/** A report with one of these has been triaged, or set aside by a human. */
export const TRIAGED = ["ready-for-agent", "ready-for-human", "wontfix"] as const;

const TRIAGE_FOOTER = "\n\n---\n_Triaged by `pnpm cw friction triage` (Haiku)._";

/** Comments from people with write access: anyone can comment on a public issue. */
export function trustedComments(comments: Comment[]): { author: string; body: string }[] {
  return comments
    .filter(({ association }) => ["OWNER", "MEMBER", "COLLABORATOR"].includes(association))
    .map(({ author, body }) => ({ author, body }));
}

type ReportBodyArgs = { what: string; cost: string; where: string; fix?: string };

/** The body `docs/agents/friction.md` asks for, from its sections. */
export function reportBody({ what, cost, where, fix }: ReportBodyArgs): string {
  const sections = [
    ["What happened", what],
    ["Cost", cost],
    ["Where", where],
    ["Suggested fix", fix],
  ] as const;
  return sections
    .filter(([, text]) => text?.trim())
    .map(([heading, text]) => `## ${heading}\n${text!.trim()}`)
    .join("\n\n");
}

/** Open (and with `closed`, closed) friction reports matching `search`, newest first. */
export async function searchReports(
  github: GitHub,
  { search, closed }: { search: string; closed: boolean },
): Promise<IssueSummary[]> {
  return await github.list({
    state: closed ? "all" : "open",
    labels: [FRICTION],
    search: search || undefined,
    limit: 20,
  });
}

/** What triage does to GitHub, in order; a dry run returns them without doing them. */
export type Action =
  | { kind: "label"; number: number; add: string[]; remove: string[] }
  | { kind: "comment"; number: number; body: string }
  | { kind: "close"; number: number; comment: string };

export type TriageOutcome =
  | { status: "already_triaged"; labels: string[]; actions: [] }
  | {
      status: "triaged";
      decision: Triage["decision"];
      duplicateOf: number | null;
      reason: string;
      actions: Action[];
    };

type ReportErrorArgs = { code: string; message: string; retryable?: boolean };

/** A refusal with a code an agent branches on (`cw`'s error output), and whether a retry may help. */
export class ReportError extends Error {
  override name = "ReportError";
  readonly code: string;
  readonly retryable: boolean;

  constructor({ code, message, retryable = false }: ReportErrorArgs) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

/** A gathered report, as triage hands it to the model; the repo's guides are added after. */
export type TriageInput = Omit<TriagePromptArgs, "guide" | "claudeMd">;

type TriageReportArgs = {
  number: number;
  /** The model's call (`triage.ts`), handed the gathered report. */
  decide: (input: TriageInput) => Promise<Triage>;
  /** Triage it again although it carries a triage label; the new label replaces the old. */
  retriage: boolean;
  dryRun: boolean;
};

/** The labels, comments and close that carry out `answer` for `issue`. */
export function triageActions({
  issue,
  open,
  answer,
}: {
  issue: Issue;
  open: IssueSummary[];
  answer: Triage;
}): Action[] {
  const { number } = issue;
  const stale = (keep?: string) =>
    TRIAGED.filter((label) => label !== keep && issue.labels.includes(label));
  if (answer.decision === "duplicate") {
    const original = answer.duplicate_of;
    // Only an open friction report other than this one counts.
    if (original === null || !open.some((report) => report.number === original)) {
      return [
        { kind: "label", number, add: ["ready-for-human"], remove: stale("ready-for-human") },
        {
          kind: "comment",
          number,
          body: `Triage called this a duplicate but named no open friction report: ${answer.reason}${TRIAGE_FOOTER}`,
        },
      ];
    }
    return [
      {
        kind: "comment",
        number: original,
        body: `Another occurrence: #${number} (${issue.title}). ${answer.reason}${TRIAGE_FOOTER}`,
      },
      {
        kind: "close",
        number,
        comment: `Duplicate of #${original}. ${answer.reason}${TRIAGE_FOOTER}`,
      },
    ];
  }
  return [
    { kind: "label", number, add: [answer.decision], remove: stale(answer.decision) },
    { kind: "comment", number, body: `\`${answer.decision}\`: ${answer.reason}${TRIAGE_FOOTER}` },
  ];
}

async function apply(github: GitHub, { action }: { action: Action }) {
  if (action.kind === "label") await github.editLabels(action);
  else if (action.kind === "comment") await github.comment(action);
  else await github.close(action);
}

/**
 * Triages friction report `number`: gathers it (with trusted comments only) beside the other open
 * reports and the recently closed ones, asks `decide`, and labels, comments or closes it.
 */
export async function triageReport(
  github: GitHub,
  { number, decide, retriage, dryRun }: TriageReportArgs,
): Promise<TriageOutcome> {
  const issue = await github.view(number);
  if (!issue.labels.includes(FRICTION)) {
    throw new ReportError({
      code: "not_a_friction_report",
      message: `#${number} has no ${FRICTION} label.`,
    });
  }
  if (issue.state !== "open") {
    throw new ReportError({ code: "not_open", message: `#${number} is closed.` });
  }
  const triagedAs = TRIAGED.filter((label) => issue.labels.includes(label));
  if (triagedAs.length > 0 && !retriage) {
    return { status: "already_triaged", labels: triagedAs, actions: [] };
  }
  const [open, closed] = await Promise.all([
    github.list({ state: "open", labels: [FRICTION], limit: 200 }),
    github.list({ state: "closed", labels: [FRICTION], limit: 60 }),
  ]);
  const others = open.filter((report) => report.number !== number);
  const answer = await decide({
    issue: JSON.stringify({
      number,
      title: issue.title,
      body: issue.body,
      labels: issue.labels,
      comments: trustedComments(issue.comments),
    }),
    open: JSON.stringify(
      others.map((other) => ({
        number: other.number,
        title: other.title,
        body: other.body.slice(0, 600),
      })),
    ),
    closed: JSON.stringify(
      closed.map((report) => ({
        number: report.number,
        title: report.title,
        closedAt: report.closedAt,
      })),
    ),
  });
  const actions = triageActions({ issue, open: others, answer });
  if (!dryRun) {
    // oxlint-disable-next-line no-await-in-loop -- in order: the original's comment before the close
    for (const action of actions) await apply(github, { action });
  }
  return {
    status: "triaged",
    decision: answer.decision,
    duplicateOf: answer.decision === "duplicate" ? answer.duplicate_of : null,
    reason: answer.reason,
    actions,
  };
}

/** Reports `numbers`, with trusted comments only, as the fixer's prompt takes them. */
export async function gatherReports(github: GitHub, { numbers }: { numbers: number[] }) {
  const issues = await Promise.all(numbers.map((number) => github.view(number)));
  const missing = issues.filter((issue) => !issue.labels.includes(FRICTION));
  if (missing.length > 0) {
    throw new ReportError({
      code: "not_a_friction_report",
      message: `No ${FRICTION} label on ${missing.map(({ number }) => `#${number}`).join(", ")}.`,
    });
  }
  return issues.map(({ number, title, body, comments }) => ({
    number,
    title,
    body,
    comments: trustedComments(comments),
  }));
}
