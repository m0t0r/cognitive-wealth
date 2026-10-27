import { refreshPullRequest } from "./refresh.ts";
import { memoryGitHub, pullRequest, REBASED_HEAD, report } from "./testing/memory-github.ts";

const RUN = "https://github.test/actions/runs/1";
const ready = (number: number) => report({ number, labels: ["friction", "ready-for-agent"] });

const refresh = (github: ReturnType<typeof memoryGitHub>["github"], overrides = {}) =>
  refreshPullRequest(github, {
    picked: [12, 13],
    branch: "chore/friction-autofix",
    baseBranch: "dev",
    runUrl: RUN,
    dryRun: false,
    wait: async () => {},
    ...overrides,
  });

describe("refreshPullRequest", () => {
  it("has GitHub rebase the bot's PR when it's behind dev", async () => {
    const gh = memoryGitHub([ready(12)], {
      pullRequests: [pullRequest({ number: 261, behind: 8 })],
    });

    expect(await refresh(gh.github)).toEqual({ status: "rebased", pr: 261, head: REBASED_HEAD });
    expect(gh.writes).toEqual([{ kind: "rebase-pr", number: 261 }]);
  });

  it.for([
    {
      name: "no open PR",
      pulls: [pullRequest({ number: 254, state: "merged", behind: 3 })],
      status: "no_pr",
    },
    { name: "a PR already on dev", pulls: [pullRequest({ number: 261 })], status: "current" },
  ])("leaves things alone with $name", async ({ pulls, status }) => {
    const gh = memoryGitHub([ready(12)], { pullRequests: pulls });

    expect(await refresh(gh.github)).toMatchObject({ status });
    expect(gh.writes).toEqual([]);
  });

  it("when GitHub won't rebase, keeps the reports waiting and asks on the PR once", async () => {
    const refused = new Error("refusing to allow a GitHub App to create or update workflow");
    const gh = memoryGitHub([ready(12), ready(13)], {
      pullRequests: [pullRequest({ number: 261, behind: 8 })],
      fail: { rebasePullRequest: refused },
    });

    const first = await refresh(gh.github);
    const second = await refresh(gh.github);

    expect(first).toEqual({
      status: "stale",
      pr: 261,
      reason: `GitHub couldn't rebase #261 onto dev: ${refused.message}`,
      asked: true,
    });
    expect(second).toMatchObject({ status: "stale", asked: false });
    expect(gh.writes).toEqual([
      {
        kind: "comment-pr",
        number: 261,
        body: expect.stringMatching(
          /^This PR is behind `dev`, and GitHub couldn't rebase #261 onto dev: refusing[\s\S]*#12, #13 wait[\s\S]*"Update branch"/,
        ),
      },
    ]);
    expect(gh.issue(12).labels).toContain("ready-for-agent");
  });

  it("asks again once the PR's head has moved and it's stuck again", async () => {
    const gh = memoryGitHub([ready(12)], {
      pullRequests: [
        pullRequest({
          number: 261,
          behind: 8,
          headSha: "2".repeat(40),
          comments: [`Stuck.\n\n<!-- friction-bot:stale:${"0".repeat(40)} -->`],
        }),
      ],
      fail: { rebasePullRequest: new Error("Merge conflict") },
    });

    expect(await refresh(gh.github)).toMatchObject({ status: "stale", asked: true });
  });

  it("calls it stale when the rebase hasn't landed after waiting", async () => {
    const gh = memoryGitHub([ready(12)], {
      pullRequests: [pullRequest({ number: 261, behind: 8 })],
    });
    const github = { ...gh.github, rebasePullRequest: async () => {} };
    const wait = vi.fn(async () => {});

    const outcome = await refresh(github, { wait });

    expect(outcome).toMatchObject({ status: "stale", asked: true });
    expect(wait).toHaveBeenCalledTimes(10);
  });

  it("only says it would rebase on a dry run", async () => {
    const gh = memoryGitHub([ready(12)], {
      pullRequests: [pullRequest({ number: 261, behind: 8 })],
    });

    expect(await refresh(gh.github, { dryRun: true })).toEqual({
      status: "would_rebase",
      pr: 261,
    });
    expect(gh.writes).toEqual([]);
  });
});
