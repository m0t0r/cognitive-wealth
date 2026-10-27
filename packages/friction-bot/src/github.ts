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

export type PullRequest = {
  /** GitHub's node id, which the GraphQL API takes. */
  id: string;
  number: number;
  state: "open" | "closed" | "merged";
  /** The commit the PR's branch pointed at when it was last open. */
  headSha: string;
  body: string;
  url: string;
};

type CreatePullRequestArgs = { head: string; base: string; title: string; body: string };

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
  /** Every PR from `head` into `base`, open, closed or merged, newest first. */
  pullRequests: (args: { head: string; base: string }) => Promise<PullRequest[]>;
  createPullRequest: (args: CreatePullRequestArgs) => Promise<{ number: number; url: string }>;
  editPullRequest: (args: { number: number; body: string }) => Promise<void>;
  /** How many of `base`'s commits `head` lacks. */
  behindBy: (args: { base: string; head: string }) => Promise<number>;
  /**
   * Asks GitHub to rebase the PR onto its base, as its "Update branch" button does; refused on a
   * conflict, or when the head is no longer `expectedHeadSha`. It may finish after this returns.
   */
  rebasePullRequest: (args: { id: string; expectedHeadSha: string }) => Promise<void>;
  /** The bodies of a PR's comments, oldest first. */
  pullRequestComments: (number: number) => Promise<string[]>;
  commentOnPullRequest: (args: { number: number; body: string }) => Promise<void>;
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

/** GitHub's "Update branch" with rebase, done on GitHub's side, only if the head is still `head`. */
const REBASE_MUTATION = `mutation($id: ID!, $head: GitObjectID!) {
  updatePullRequestBranch(input: { pullRequestId: $id, expectedHeadOid: $head, updateMethod: REBASE }) {
    pullRequest { headRefOid }
  }
}`;

type GhPullRequest = {
  id: string;
  isCrossRepository: boolean;
  number: number;
  state: "OPEN" | "CLOSED" | "MERGED";
  headRefOid: string;
  body: string;
  url: string;
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
    async pullRequests({ head, base }) {
      const pulls: GhPullRequest[] = JSON.parse(
        await gh({
          args: [
            "pr",
            "list",
            "--head",
            head,
            "--base",
            base,
            "--state",
            "all",
            "--limit",
            "50",
            "--json",
            "id,number,state,headRefOid,body,url,isCrossRepository",
          ],
        }),
      );
      // `--head` matches a fork's branch of the same name too; only this repository's count.
      return pulls
        .filter(({ isCrossRepository }) => !isCrossRepository)
        .map((pull) => ({
          id: pull.id,
          number: pull.number,
          state: pull.state === "OPEN" ? "open" : pull.state === "MERGED" ? "merged" : "closed",
          headSha: pull.headRefOid,
          body: pull.body,
          url: pull.url,
        }));
    },
    async behindBy({ base, head }) {
      const compare: { behind_by: number } = JSON.parse(
        await gh({ args: ["api", `repos/{owner}/{repo}/compare/${base}...${head}`] }),
      );
      return compare.behind_by;
    },
    async pullRequestComments(number) {
      const pull: { comments: { body: string }[] } = JSON.parse(
        await gh({ args: ["pr", "view", String(number), "--json", "comments"] }),
      );
      return pull.comments.map(({ body }) => body);
    },
    async commentOnPullRequest({ number, body }) {
      await gh({ args: ["pr", "comment", String(number), "--body-file", "-"], input: body });
    },
    async rebasePullRequest({ id, expectedHeadSha }) {
      await gh({
        args: [
          "api",
          "graphql",
          "-f",
          `query=${REBASE_MUTATION}`,
          "-f",
          `id=${id}`,
          "-f",
          `head=${expectedHeadSha}`,
        ],
      });
    },
    async createPullRequest({ head, base, title, body }) {
      const url = (
        await gh({
          args: [
            "pr",
            "create",
            "--head",
            head,
            "--base",
            base,
            "--title",
            title,
            "--body-file",
            "-",
          ],
          input: body,
        })
      ).trim();
      return { number: Number(url.slice(url.lastIndexOf("/") + 1)), url };
    },
    async editPullRequest({ number, body }) {
      await gh({ args: ["pr", "edit", String(number), "--body-file", "-"], input: body });
    },
  };
}
