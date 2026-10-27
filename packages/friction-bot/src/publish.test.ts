import type { CommitOutcome } from "./commit.ts";
import { type FixAnswer, handBack, parseAnswer, publishFix } from "./publish.ts";
import { memoryGitHub, pullRequest, report } from "./testing/memory-github.ts";

const RUN = "https://github.test/actions/runs/1";
const COMMIT = "a".repeat(40);
const NOW = new Date("2026-10-27T13:05:00Z");

const ready = (number: number) => report({ number, labels: ["friction", "ready-for-agent"] });

const answer: FixAnswer = {
  fixed: [{ number: 12, summary: "Fixed CLAUDE.md." }],
  skipped: [{ number: 13, reason: "Needs .github/." }],
  friction: [
    {
      title: "org.test.ts times out cold",
      what: "5000 ms",
      cost: "a rerun",
      where: "org.test.ts",
      fix: "",
    },
  ],
};

const committed: CommitOutcome = {
  status: "committed",
  commit: COMMIT,
  base: "b".repeat(40),
  files: ["CLAUDE.md"],
  dropped: [],
};

type SetupArgs = {
  pulls?: ReturnType<typeof pullRequest>[];
  fail?: NonNullable<Parameters<typeof memoryGitHub>[1]>["fail"];
};

function setup({ pulls = [], fail }: SetupArgs = {}) {
  return memoryGitHub([ready(12), ready(13), ready(14)], {
    pullRequests: pulls,
    ...(fail ? { fail } : {}),
  });
}

const pushed = () => vi.fn(async () => ({ commit: COMMIT, stacked: false }));

const publish = (github: ReturnType<typeof setup>["github"], overrides = {}) =>
  publishFix(github, {
    picked: [12, 13, 14],
    answer,
    commit: committed,
    push: pushed(),
    branch: "chore/friction-autofix",
    baseBranch: "dev",
    runUrl: RUN,
    now: NOW,
    dryRun: false,
    ...overrides,
  });

/** The labels and last comment each report ends with. */
const fate = (gh: ReturnType<typeof setup>, number: number) => {
  const issue = gh.issue(number);
  return { labels: issue.labels, comment: issue.comments.at(-1)?.body ?? "" };
};

describe("publishFix", () => {
  it("opens a PR for the pushed fix and relabels each report from what happened to it", async () => {
    const gh = setup();

    const outcome = await publish(gh.github);

    expect(outcome.errors).toEqual([]);
    expect(outcome.pullRequest).toEqual({
      number: 16,
      url: "https://github.test/pull/16",
      created: true,
    });
    expect(gh.writes.find(({ kind }) => kind === "create-pr")).toMatchObject({
      head: "chore/friction-autofix",
      base: "dev",
      body: expect.stringMatching(
        /Approve workflows to run[\s\S]*### 2026-10-27 13:05 UTC, \[run\]\(https:\/\/github\.test\/actions\/runs\/1\)\n\n- Closes #12: Fixed CLAUDE\.md\.\n- Skipped #13 \(now `ready-for-human`\): Needs \.github\/\./,
      ),
    });
    expect(fate(gh, 12)).toEqual({
      labels: ["friction"],
      comment: expect.stringMatching(/^Fixed in #16: Fixed CLAUDE\.md\./),
    });
    expect(fate(gh, 13)).toEqual({
      labels: ["friction", "ready-for-human"],
      comment: expect.stringMatching(/^Passed on: Needs \.github\/\./),
    });
    expect(fate(gh, 14)).toEqual({
      labels: ["friction", "ready-for-human"],
      comment: expect.stringMatching(/^The agent's answer didn't mention this report\./),
    });
  });

  it("files the fixer's own friction first, ready-for-human, before anything that can fail", async () => {
    const gh = setup();
    const push = vi.fn(() =>
      Promise.reject(Object.assign(new Error("rejected"), { code: "push_rejected" })),
    );

    const outcome = await publish(gh.github, { push });

    expect(gh.writes[0]).toMatchObject({
      kind: "create",
      title: "org.test.ts times out cold",
      labels: ["friction", "ready-for-human"],
      body: expect.stringContaining(
        "_Found by [friction-fix.yml](https://github.test/actions/runs/1) (Sonnet) while fixing #12, #13, #14._",
      ),
    });
    expect(outcome.filed).toEqual([{ number: 15, title: "org.test.ts times out cold" }]);
    expect(outcome.errors).toEqual([{ step: "push", code: "push_rejected", message: "rejected" }]);
    expect(fate(gh, 12)).toEqual({
      labels: ["friction", "ready-for-human"],
      comment: expect.stringMatching(/^Pushing the fix failed: rejected/),
    });
  });

  it("adds a section to the bot's open PR", async () => {
    const gh = setup({ pulls: [pullRequest({ number: 261, body: "Earlier runs." })] });

    const outcome = await publish(gh.github);

    expect(outcome.pullRequest).toEqual({
      number: 261,
      url: "https://github.test/pull/261",
      created: false,
    });
    expect(gh.writes.find(({ kind }) => kind === "edit-pr")).toEqual({
      kind: "edit-pr",
      number: 261,
      body: expect.stringMatching(/^Earlier runs\.\n\n### 2026-10-27 13:05 UTC/),
    });
    expect(fate(gh, 12).comment).toMatch(/^Fixed in #261: /);
  });

  it("says the fix is on the branch when its PR can't be opened, not that it failed", async () => {
    const refused = Object.assign(
      new Error("GitHub Actions is not permitted to create or approve pull requests"),
      { code: "gh_failed" },
    );
    const gh = setup({ fail: { createPullRequest: refused } });

    const outcome = await publish(gh.github);

    expect(outcome.pushed).toEqual({ commit: COMMIT, stacked: false });
    expect(outcome.errors).toEqual([
      { step: "pull_request", code: "gh_failed", message: refused.message },
    ]);
    expect(fate(gh, 12)).toEqual({
      labels: ["friction", "ready-for-human"],
      comment: expect.stringMatching(
        /^The fix is on `chore\/friction-autofix` \(aaaaaaa\), but its PR couldn't be opened: GitHub Actions is not permitted/,
      ),
    });
    expect(fate(gh, 13).comment).toMatch(/^Passed on: /);
  });

  it.for([
    {
      name: "a failed check",
      commit: { status: "checks_failed", check: "test:integration", output: "x", dropped: [] },
      says: /^The fix failed `pnpm test:integration`, so it wasn't committed\./,
    },
    {
      name: "a path only the user changes",
      commit: { status: "forbidden", paths: [".github/x.yml"], dropped: [] },
      says: /^The fix changed paths only the user changes \(\.github\/x\.yml\), so it wasn't committed\./,
    },
    {
      name: "no change",
      commit: { status: "no_changes", dropped: [] },
      says: /^The agent called this fixed but changed no file\./,
    },
    {
      name: "no commit step outcome",
      commit: null,
      says: /^The fix wasn't committed: the commit step didn't finish\./,
    },
  ] as const)("hands a fixed report back with $name as the reason", async ({ commit, says }) => {
    const gh = setup();
    const push = pushed();

    const outcome = await publish(gh.github, { commit, push });

    expect(push).not.toHaveBeenCalled();
    expect(outcome.pullRequest).toBeNull();
    expect(fate(gh, 12)).toEqual({
      labels: ["friction", "ready-for-human"],
      comment: expect.stringMatching(says),
    });
  });

  it("writes nothing on a dry run, and lists what it would do", async () => {
    const gh = setup({ pulls: [pullRequest({ number: 261 })] });
    const push = pushed();

    const outcome = await publish(gh.github, { push, dryRun: true });

    expect(gh.writes).toEqual([]);
    expect(push).toHaveBeenCalled();
    expect(outcome).toMatchObject({
      filed: [{ number: null, title: "org.test.ts times out cold" }],
      pullRequest: { number: 261, created: false },
      reports: [
        { number: 12, labels: { add: [], remove: ["ready-for-agent"] } },
        { number: 13, labels: { add: ["ready-for-human"] } },
        { number: 14, labels: { add: ["ready-for-human"] } },
      ],
    });
  });
});

describe("parseAnswer", () => {
  it("keeps only the picked reports and at most 3 frictions, with long text cut", () => {
    const friction = { title: "t".repeat(300), what: "w", cost: "c", where: "x", fix: "" };
    const parsed = parseAnswer({
      value: {
        fixed: [
          { number: 12, summary: "s" },
          { number: 99, summary: "not picked" },
        ],
        skipped: [{ number: 13, reason: "r" }],
        friction: [friction, friction, friction, friction],
        steps: 7,
      },
      picked: [12, 13],
    });
    expect(parsed.fixed).toEqual([{ number: 12, summary: "s" }]);
    expect(parsed.skipped).toEqual([{ number: 13, reason: "r" }]);
    expect(parsed.friction).toHaveLength(3);
    expect(parsed.friction[0]?.title).toHaveLength(200);
  });

  it("refuses an answer of the wrong shape", () => {
    expect(() => parseAnswer({ value: { fixed: "all" }, picked: [12] })).toThrow(
      expect.objectContaining({ code: "invalid_answer" }),
    );
  });
});

describe("handBack", () => {
  it("hands back only the reports still ready-for-agent", async () => {
    const gh = memoryGitHub([
      ready(12),
      report({ number: 13, labels: ["friction"] }),
      report({ number: 14, labels: ["friction", "ready-for-agent"], state: "closed" }),
    ]);

    const outcome = await handBack(gh.github, {
      numbers: [12, 13, 14],
      runUrl: RUN,
      dryRun: false,
    });

    expect(outcome).toEqual({ handedBack: [12], left: [13, 14] });
    expect(fate(gh, 12)).toEqual({
      labels: ["friction", "ready-for-human"],
      comment: expect.stringMatching(
        /^The automated fix didn't finish \(\[run\]\(https:\/\/github\.test\/actions\/runs\/1\)\)/,
      ),
    });
    expect(gh.writes.filter((write) => !("number" in write) || write.number !== 12)).toEqual([]);
  });

  it("changes nothing on a dry run", async () => {
    const gh = memoryGitHub([ready(12)]);

    const outcome = await handBack(gh.github, { numbers: [12], runUrl: RUN, dryRun: true });

    expect(outcome).toEqual({ handedBack: [12], left: [] });
    expect(gh.writes).toEqual([]);
  });
});
