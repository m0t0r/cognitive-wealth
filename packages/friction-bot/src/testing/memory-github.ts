// A GitHub of issues and PRs in memory, for tests here and in `@repo/cli`: it answers `GitHub`'s
// calls from `issues` and `pullRequests`, applies every write to them and records it in `writes`,
// so a test checks what reached GitHub. `fail` makes a call throw, as GitHub refusing it would.
import type { GitHub, Issue, PullRequest } from "../github.ts";

type Write =
  | { kind: "create"; title: string; body: string; labels: string[] }
  | { kind: "comment"; number: number; body: string }
  | { kind: "label"; number: number; add: string[]; remove: string[] }
  | { kind: "close"; number: number; comment: string }
  | { kind: "create-pr"; head: string; base: string; title: string; body: string }
  | { kind: "edit-pr"; number: number; body: string };

/** An open friction report, with whatever a test overrides. */
export function report(overrides: Partial<Issue> & { number: number }): Issue {
  return {
    title: `Report ${overrides.number}`,
    body: "## What happened\nIt broke.",
    state: "open",
    url: `https://github.test/issues/${overrides.number}`,
    labels: ["friction"],
    createdAt: "2026-10-26T10:00:00Z",
    closedAt: null,
    comments: [],
    ...overrides,
  };
}

type MemoryPullRequest = PullRequest & { head: string; base: string };

/** A PR from the bot's branch, with whatever a test overrides. */
export function pullRequest(
  overrides: Partial<MemoryPullRequest> & { number: number },
): MemoryPullRequest {
  return {
    state: "open",
    headSha: "0".repeat(40),
    body: "",
    url: `https://github.test/pull/${overrides.number}`,
    head: "chore/friction-autofix",
    base: "dev",
    ...overrides,
  };
}

type MemoryGitHubOptions = {
  pullRequests?: MemoryPullRequest[];
  /** Calls that throw this error instead of answering. */
  fail?: Partial<Record<keyof GitHub, Error>>;
};

export function memoryGitHub(issues: Issue[] = [], options: MemoryGitHubOptions = {}) {
  const writes: Write[] = [];
  const byNumber = new Map(issues.map((issue) => [issue.number, issue]));
  const pulls = [...(options.pullRequests ?? [])];
  const find = (number: number) => {
    const issue = byNumber.get(number);
    if (!issue) throw new Error(`No issue #${number} in this test's GitHub`);
    return issue;
  };
  const failing = (call: keyof GitHub) => {
    const error = options.fail?.[call];
    if (error) throw error;
  };
  const nextNumber = () =>
    Math.max(0, ...byNumber.keys(), ...pulls.map(({ number }) => number)) + 1;
  const github: GitHub = {
    view: async (number) => (failing("view"), find(number)),
    list: async ({ state, labels, search, limit }) => (
      failing("list"),
      [...byNumber.values()]
        .filter((issue) => state === "all" || issue.state === state)
        .filter((issue) => labels.every((label) => issue.labels.includes(label)))
        .filter(
          (issue) =>
            !search ||
            search
              .toLowerCase()
              .split(/\s+/)
              .every((word) => `${issue.title} ${issue.body}`.toLowerCase().includes(word)),
        )
        .toSorted((a, b) => b.number - a.number)
        .slice(0, limit)
        .map(({ comments: _comments, ...summary }) => summary)
    ),
    async create({ title, body, labels }) {
      failing("create");
      writes.push({ kind: "create", title, body, labels });
      const number = nextNumber();
      byNumber.set(number, report({ number, title, body, labels }));
      return { number, url: `https://github.test/issues/${number}` };
    },
    async comment({ number, body }) {
      failing("comment");
      const issue = find(number);
      writes.push({ kind: "comment", number, body });
      byNumber.set(number, {
        ...issue,
        comments: [...issue.comments, { author: "github-actions", body, association: "NONE" }],
      });
      return { url: `https://github.test/issues/${number}#comment` };
    },
    async editLabels({ number, add, remove }) {
      failing("editLabels");
      const issue = find(number);
      writes.push({ kind: "label", number, add, remove });
      const labels = issue.labels.filter((label) => !remove.includes(label));
      byNumber.set(number, { ...issue, labels: [...new Set([...labels, ...add])] });
    },
    async close({ number, comment }) {
      failing("close");
      const issue = find(number);
      writes.push({ kind: "close", number, comment });
      byNumber.set(number, { ...issue, state: "closed", closedAt: "2026-10-27T12:00:00Z" });
    },
    pullRequests: async ({ head, base }) => (
      failing("pullRequests"),
      pulls
        .filter((pull) => pull.head === head && pull.base === base)
        .toSorted((a, b) => b.number - a.number)
        .map(({ head: _head, base: _base, ...pull }) => pull)
    ),
    async createPullRequest({ head, base, title, body }) {
      failing("createPullRequest");
      writes.push({ kind: "create-pr", head, base, title, body });
      const number = nextNumber();
      pulls.push(pullRequest({ number, head, base, body }));
      return { number, url: `https://github.test/pull/${number}` };
    },
    async editPullRequest({ number, body }) {
      failing("editPullRequest");
      const index = pulls.findIndex((pull) => pull.number === number);
      if (index === -1) throw new Error(`No PR #${number} in this test's GitHub`);
      writes.push({ kind: "edit-pr", number, body });
      pulls[index] = { ...pulls[index]!, body };
    },
  };
  return { github, writes, issue: find };
}
