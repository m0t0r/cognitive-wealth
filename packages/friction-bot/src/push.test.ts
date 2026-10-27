import { join } from "node:path";
import type { PullRequest } from "./github.ts";
import { pushFix, startFix, startingPoint } from "./push.ts";
import { git, type TempRepo, tempRepo } from "./testing/git-repo.ts";

const BRANCH = "chore/friction-autofix";

const pull = (overrides: Partial<PullRequest> & Pick<PullRequest, "state" | "headSha">) => ({
  id: "PR_261",
  number: 261,
  body: "",
  url: "https://github.test/pull/261",
  ...overrides,
});

describe("startingPoint", () => {
  it.for([
    { name: "no bot branch", tip: null, pulls: [], from: "base" },
    { name: "a branch no PR has had (its PR failed to open)", tip: "b", pulls: [], from: "branch" },
    {
      name: "a branch with an open PR",
      tip: "b",
      pulls: [pull({ state: "open", headSha: "b" })],
      from: "branch",
    },
    {
      name: "a branch whose PR was closed (rejected)",
      tip: "b",
      pulls: [pull({ state: "closed", headSha: "b" })],
      from: "base",
    },
    {
      name: "a branch whose PR was merged",
      tip: "b",
      pulls: [pull({ state: "merged", headSha: "b" })],
      from: "base",
    },
    {
      name: "a branch pushed to after its PR was closed",
      tip: "c",
      pulls: [pull({ state: "closed", headSha: "b" })],
      from: "branch",
    },
  ] as const)("starts from $from for $name", ({ tip, pulls, from }) => {
    expect(startingPoint({ tip, pulls: [...pulls] })).toBe(from);
  });
});

describe("pushFix", () => {
  let repo: TempRepo;
  /** The publish job's checkout: a clone of origin on dev, which pushes. */
  let publisher: string;

  beforeEach(async () => {
    repo = await tempRepo();
    publisher = join(repo.dir, "publisher");
    await git({ cwd: repo.dir, args: ["clone", "-q", repo.origin, publisher] });
  });

  afterEach(async () => {
    await repo.remove();
  });

  /** A fix of `commits` commits on `from` in the fixer's clone, bundled; returns its base. */
  async function bundled({ from, commits = 1 }: { from: string; commits?: number }) {
    await repo.git(["fetch", "-q", "origin"]);
    await repo.git(["checkout", "-q", "-B", BRANCH, from]);
    const base = await repo.git(["rev-parse", "HEAD"]);
    for (let n = 0; n < commits; n++) {
      // oxlint-disable-next-line no-await-in-loop -- commits in order
      await repo.commit({ files: { [`fix-${n}.md`]: `${n}\n` } });
    }
    const bundle = join(repo.dir, "fix.bundle");
    await repo.git(["bundle", "create", "-q", bundle, `${base}..HEAD`]);
    return { base, bundle, tip: await repo.git(["rev-parse", "HEAD"]) };
  }

  const branchOnOrigin = () =>
    git({ cwd: repo.origin, args: ["rev-parse", "-q", "--verify", `refs/heads/${BRANCH}`] }).catch(
      () => null,
    );

  /** An unmerged bot branch on origin, as a run whose PR wasn't opened leaves it. */
  async function leftoverBranch() {
    await repo.git(["checkout", "-q", "-B", BRANCH, "origin/dev"]);
    const tip = await repo.commit({ files: { "earlier.md": "earlier fix\n" } });
    await repo.git(["push", "-q", "origin", BRANCH]);
    return tip;
  }

  it("pushes a fix on dev as the new bot branch", async () => {
    const { base, bundle, tip } = await bundled({ from: "origin/dev" });

    const pushed = await pushFix({
      root: publisher,
      bundle,
      base,
      branch: BRANCH,
      baseBranch: "dev",
      pulls: [],
    });

    expect(pushed).toEqual({ commit: tip, stacked: false });
    expect(await branchOnOrigin()).toBe(tip);
  });

  it("stacks a fix on the bot branch that's already there", async () => {
    await leftoverBranch();
    const { base, bundle, tip } = await bundled({ from: `origin/${BRANCH}` });

    const pushed = await pushFix({
      root: publisher,
      bundle,
      base,
      branch: BRANCH,
      baseBranch: "dev",
      pulls: [],
    });

    expect(pushed).toEqual({ commit: tip, stacked: true });
    expect(await branchOnOrigin()).toBe(tip);
  });

  it("never overwrites an unmerged bot branch with a fix made on dev", async () => {
    const earlier = await leftoverBranch();
    const { base, bundle } = await bundled({ from: "origin/dev" });

    await expect(
      pushFix({ root: publisher, bundle, base, branch: BRANCH, baseBranch: "dev", pulls: [] }),
    ).rejects.toMatchObject({ code: "bundle_mismatch" });
    expect(await branchOnOrigin()).toBe(earlier);
  });

  it("replaces the branch of a closed PR with a fix made on dev", async () => {
    const rejected = await leftoverBranch();
    const { base, bundle, tip } = await bundled({ from: "origin/dev" });

    const pushed = await pushFix({
      root: publisher,
      bundle,
      base,
      branch: BRANCH,
      baseBranch: "dev",
      pulls: [pull({ state: "closed", headSha: rejected })],
    });

    expect(pushed).toEqual({ commit: tip, stacked: false });
    expect(await branchOnOrigin()).toBe(tip);
  });

  it("refuses to stack a fix on a closed PR's branch", async () => {
    const rejected = await leftoverBranch();
    const { base, bundle } = await bundled({ from: `origin/${BRANCH}` });

    await expect(
      pushFix({
        root: publisher,
        bundle,
        base,
        branch: BRANCH,
        baseBranch: "dev",
        pulls: [pull({ state: "closed", headSha: rejected })],
      }),
    ).rejects.toMatchObject({ code: "bundle_mismatch" });
    expect(await branchOnOrigin()).toBe(rejected);
  });

  it("refuses a bundle of more than one commit", async () => {
    const { bundle } = await bundled({ from: "origin/dev", commits: 2 });
    const base = await repo.git(["rev-parse", "HEAD~1"]);

    await expect(
      pushFix({ root: publisher, bundle, base, branch: BRANCH, baseBranch: "dev", pulls: [] }),
    ).rejects.toMatchObject({ code: "bundle_mismatch" });
    expect(await branchOnOrigin()).toBeNull();
  });

  it("refuses a commit that changes a path only the user changes", async () => {
    await repo.git(["checkout", "-q", "-B", BRANCH, "origin/dev"]);
    const base = await repo.git(["rev-parse", "HEAD"]);
    await repo.commit({
      files: { ".claude/skills/x/run.sh": "echo\n", ".github/workflows/é.yml": "on: push\n" },
    });
    const bundle = join(repo.dir, "fix.bundle");
    await repo.git(["bundle", "create", "-q", bundle, `${base}..HEAD`]);

    await expect(
      pushFix({ root: publisher, bundle, base, branch: BRANCH, baseBranch: "dev", pulls: [] }),
    ).rejects.toMatchObject({
      code: "forbidden_paths",
      message: /\.claude\/skills\/x\/run\.sh, \.github\/workflows\/é\.yml/,
    });
    expect(await branchOnOrigin()).toBeNull();
  });

  it("checks the bundle but pushes nothing on a dry run", async () => {
    const { base, bundle, tip } = await bundled({ from: "origin/dev" });

    const pushed = await pushFix({
      root: publisher,
      bundle,
      base,
      branch: BRANCH,
      baseBranch: "dev",
      pulls: [],
      dryRun: true,
    });

    expect(pushed).toEqual({ commit: tip, stacked: false });
    expect(await branchOnOrigin()).toBeNull();
  });
});

describe("startFix", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = await tempRepo();
  });

  afterEach(async () => {
    await repo.remove();
  });

  it("puts the checkout on the bot branch at the tip it starts from", async () => {
    await repo.git(["checkout", "-q", "-B", BRANCH, "origin/dev"]);
    const earlier = await repo.commit({ files: { "earlier.md": "earlier\n" } });
    await repo.git(["push", "-q", "origin", BRANCH]);
    await repo.git(["checkout", "-q", "dev"]);
    await repo.git(["branch", "-q", "-D", BRANCH]);
    const dev = await repo.git(["rev-parse", "origin/dev"]);

    const open = await startFix({ root: repo.clone, branch: BRANCH, baseBranch: "dev", pulls: [] });
    expect(open).toEqual({ from: "branch", commit: earlier });
    expect(await repo.git(["rev-parse", "--abbrev-ref", "HEAD"])).toBe(BRANCH);

    const closed = await startFix({
      root: repo.clone,
      branch: BRANCH,
      baseBranch: "dev",
      pulls: [pull({ state: "closed", headSha: earlier })],
    });
    expect(closed).toEqual({ from: "base", commit: dev });
    expect(await repo.git(["rev-parse", "HEAD"])).toBe(dev);
  });
});
