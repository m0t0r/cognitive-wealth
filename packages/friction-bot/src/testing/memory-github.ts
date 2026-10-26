// A GitHub of issues in memory, for tests here and in `@repo/cli`: it answers `GitHub`'s calls
// from `issues` and records every write in `writes`, so a test checks what reached GitHub.
import type { GitHub, Issue } from "../github.ts";

type Write =
  | { kind: "create"; title: string; body: string; labels: string[] }
  | { kind: "comment"; number: number; body: string }
  | { kind: "label"; number: number; add: string[]; remove: string[] }
  | { kind: "close"; number: number; comment: string };

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

export function memoryGitHub(issues: Issue[] = []) {
  const writes: Write[] = [];
  const byNumber = new Map(issues.map((issue) => [issue.number, issue]));
  const find = (number: number) => {
    const issue = byNumber.get(number);
    if (!issue) throw new Error(`No issue #${number} in this test's GitHub`);
    return issue;
  };
  const github: GitHub = {
    view: async (number) => find(number),
    list: async ({ state, labels, search, limit }) =>
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
        .map(({ comments: _comments, ...summary }) => summary),
    async create({ title, body, labels }) {
      writes.push({ kind: "create", title, body, labels });
      const number = Math.max(0, ...byNumber.keys()) + 1;
      byNumber.set(number, report({ number, title, body, labels }));
      return { number, url: `https://github.test/issues/${number}` };
    },
    async comment({ number, body }) {
      find(number);
      writes.push({ kind: "comment", number, body });
      return { url: `https://github.test/issues/${number}#comment` };
    },
    async editLabels({ number, add, remove }) {
      find(number);
      writes.push({ kind: "label", number, add, remove });
    },
    async close({ number, comment }) {
      find(number);
      writes.push({ kind: "close", number, comment });
    },
  };
  return { github, writes };
}
