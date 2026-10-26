// The friction commands' only way to GitHub: the `gh` CLI, so a session uses the login it already
// has and a workflow its `GH_TOKEN`, with the repository from `GH_REPO` or the checkout's remote.
// Bodies go through stdin (`--body-file -`), never an argument, so their length and newlines don't
// matter. Tests hand in `memoryGitHub()` (`./testing/memory-github.ts`) instead.
import { spawn } from "node:child_process";

export type Comment = {
  author: string;
  body: string;
  /** GitHub's `authorAssociation`: `OWNER`, `MEMBER`, `COLLABORATOR` have write access. */
  association: string;
};

export type Issue = {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  url: string;
  labels: string[];
  createdAt: string;
  closedAt: string | null;
  comments: Comment[];
};

export type IssueSummary = Omit<Issue, "comments">;

type ListArgs = {
  state: "open" | "closed" | "all";
  labels: string[];
  /** GitHub search terms, as `gh issue list --search` takes them. */
  search?: string;
  limit: number;
};

type EditLabelsArgs = { number: number; add: string[]; remove: string[] };

export type GitHub = {
  view: (number: number) => Promise<Issue>;
  list: (args: ListArgs) => Promise<IssueSummary[]>;
  create: (args: {
    title: string;
    body: string;
    labels: string[];
  }) => Promise<{ number: number; url: string }>;
  comment: (args: { number: number; body: string }) => Promise<{ url: string }>;
  editLabels: (args: EditLabelsArgs) => Promise<void>;
  /** Closes it as not planned, with `comment`. */
  close: (args: { number: number; comment: string }) => Promise<void>;
};

const SUMMARY_FIELDS = "number,title,body,state,url,labels,createdAt,closedAt";

type GhIssue = {
  number: number;
  title: string;
  body: string;
  state: string;
  url: string;
  labels: { name: string }[];
  createdAt: string;
  closedAt: string | null;
  comments?: { author: { login: string } | null; body: string; authorAssociation: string }[];
};

function summary(issue: GhIssue): IssueSummary {
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state.toLowerCase() === "closed" ? "closed" : "open",
    url: issue.url,
    labels: issue.labels.map(({ name }) => name),
    createdAt: issue.createdAt,
    closedAt: issue.closedAt || null,
  };
}

export class GhError extends Error {
  override name = "GhError";
  readonly code = "gh_failed";
}

async function gh({ args, input }: { args: string[]; input?: string }): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn("gh", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
    child.on("error", (error) =>
      reject(new GhError(`gh couldn't start (${error.message}); is the GitHub CLI installed?`)),
    );
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new GhError(`gh ${args.slice(0, 2).join(" ")} failed: ${stderr.trim()}`));
    });
    child.stdin.end(input ?? "");
  });
}

export function ghCli(): GitHub {
  return {
    async view(number) {
      const issue: GhIssue = JSON.parse(
        await gh({
          args: ["issue", "view", String(number), "--json", `${SUMMARY_FIELDS},comments`],
        }),
      );
      return {
        ...summary(issue),
        comments: (issue.comments ?? []).map((comment) => ({
          author: comment.author?.login ?? "ghost",
          body: comment.body,
          association: comment.authorAssociation,
        })),
      };
    },
    async list({ state, labels, search, limit }) {
      const args = ["issue", "list", "--state", state, "--limit", String(limit)];
      for (const label of labels) args.push("--label", label);
      if (search) args.push("--search", search);
      const issues: GhIssue[] = JSON.parse(await gh({ args: [...args, "--json", SUMMARY_FIELDS] }));
      return issues.map(summary);
    },
    async create({ title, body, labels }) {
      const args = ["issue", "create", "--title", title, "--body-file", "-"];
      for (const label of labels) args.push("--label", label);
      const url = (await gh({ args, input: body })).trim();
      return { number: Number(url.slice(url.lastIndexOf("/") + 1)), url };
    },
    async comment({ number, body }) {
      const url = await gh({
        args: ["issue", "comment", String(number), "--body-file", "-"],
        input: body,
      });
      return { url: url.trim() };
    },
    async editLabels({ number, add, remove }) {
      const args = ["issue", "edit", String(number)];
      for (const label of add) args.push("--add-label", label);
      for (const label of remove) args.push("--remove-label", label);
      await gh({ args });
    },
    async close({ number, comment }) {
      await gh({
        args: ["issue", "close", String(number), "--reason", "not planned", "--comment", comment],
      });
    },
  };
}
