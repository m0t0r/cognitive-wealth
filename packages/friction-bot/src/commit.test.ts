import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { COMMIT_CHECKS, commitFix, names } from "./commit.ts";
import { type TempRepo, tempRepo } from "./testing/git-repo.ts";
import type { Check, CheckResult } from "./tools.ts";

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

describe("names", () => {
  it.for([
    ["Added docs/kept.md.", "docs/kept.md", true],
    ["Added `docs/kept.md` and more", "docs/kept.md", true],
    ["Added docs/kept.md.", "kept.md", false],
    ["Added docs/kept.md.bak", "docs/kept.md", false],
    ["Added docs/kept.mdx", "docs/kept.md", false],
  ] as const)("in %j, %s is named: %s", ([summary, path, named]) => {
    expect(names({ summary, path })).toBe(named);
  });
});

describe("commitFix", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = await tempRepo();
  });

  afterEach(async () => {
    await repo.remove();
  });

  /** Checks that pass, or fail at `failing`, recording what each one saw of `seen`. */
  function checks({ failing, seen }: { failing?: Check; seen?: string } = {}) {
    const ran: { check: Check; saw?: boolean }[] = [];
    const runCheck = async (check: Check): Promise<CheckResult> => {
      ran.push({ check, ...(seen ? { saw: await exists(join(repo.clone, seen)) } : {}) });
      return check === failing
        ? { exitCode: 1, output: `${check} failed` }
        : { exitCode: 0, output: "" };
    };
    return { ran, runCheck };
  }

  it("runs every check, then commits the fix as one commit and bundles it", async () => {
    await repo.write({ "README.md": "fixed\n" });
    const { ran, runCheck } = checks();
    const bundle = join(repo.dir, "fix.bundle");

    const outcome = await commitFix({
      root: repo.clone,
      fixed: [{ number: 12, summary: "Fixed README.md." }],
      runCheck,
      bundle,
    });

    expect(ran.map(({ check }) => check)).toEqual([
      "lint",
      "format:check",
      "check-types",
      "test",
      "test:integration",
    ]);
    expect(COMMIT_CHECKS).toContain("test:integration");
    const base = await repo.git(["rev-parse", "origin/dev"]);
    expect(outcome).toEqual({
      status: "committed",
      commit: await repo.git(["rev-parse", "HEAD"]),
      base,
      files: ["README.md"],
      dropped: [],
    });
    expect(await repo.git(["log", "-1", "--format=%s%n%an"])).toBe(
      "chore: address friction reports (#12)\ngithub-actions[bot]",
    );
    expect(await repo.git(["bundle", "list-heads", bundle])).toMatch(/ HEAD$/);
  });

  it("deletes a new file no fixed report's summary names, before the checks", async () => {
    await repo.write({
      "docs/kept.md": "kept\n",
      "packages/db/src/tmp-jsonb.integration.test.ts": "scratch\n",
    });
    const { ran, runCheck } = checks({ seen: "packages/db/src/tmp-jsonb.integration.test.ts" });

    const outcome = await commitFix({
      root: repo.clone,
      fixed: [{ number: 12, summary: "Added docs/kept.md." }],
      runCheck,
      bundle: join(repo.dir, "fix.bundle"),
    });

    expect(outcome).toMatchObject({
      status: "committed",
      files: ["docs/kept.md"],
      dropped: ["packages/db/src/tmp-jsonb.integration.test.ts"],
    });
    expect(ran.every(({ saw }) => saw === false)).toBe(true);
    expect(await exists(join(repo.clone, "packages/db/src/tmp-jsonb.integration.test.ts"))).toBe(
      false,
    );
  });

  it("commits nothing when a check fails, and says which", async () => {
    await repo.write({ "README.md": "fixed\n" });
    const { ran, runCheck } = checks({ failing: "check-types" });

    const outcome = await commitFix({
      root: repo.clone,
      fixed: [{ number: 12, summary: "Fixed README.md." }],
      runCheck,
      bundle: join(repo.dir, "fix.bundle"),
    });

    expect(outcome).toEqual({
      status: "checks_failed",
      check: "check-types",
      output: "check-types failed",
      dropped: [],
    });
    expect(ran.map(({ check }) => check)).toEqual(["lint", "format:check", "check-types"]);
    expect(await repo.git(["rev-parse", "HEAD"])).toBe(await repo.git(["rev-parse", "origin/dev"]));
    expect(await exists(join(repo.dir, "fix.bundle"))).toBe(false);
  });

  it("refuses a change to a path only the user changes, without running the checks", async () => {
    await repo.commit({ files: { ".claude/skills/x/run.sh": "echo\n" } });
    await repo.git(["push", "-q", "origin", "dev"]);
    await repo.git(["rm", "-q", ".claude/skills/x/run.sh"]);
    await repo.write({ ".github/workflows/x.yml": "on: push\n", "README.md": "fixed\n" });
    const { ran, runCheck } = checks();

    const outcome = await commitFix({
      root: repo.clone,
      fixed: [{ number: 12, summary: "Changed .github/workflows/x.yml and README.md." }],
      runCheck,
      bundle: join(repo.dir, "fix.bundle"),
    });

    expect(outcome).toEqual({
      status: "forbidden",
      paths: [".claude/skills/x/run.sh", ".github/workflows/x.yml"],
      dropped: [],
    });
    expect(ran).toEqual([]);
  });

  it("refuses a forbidden path that git would quote, or spelled in another case", async () => {
    await repo.write({ ".github/workflows/é.yml": "on: push\n", ".Claude/hooks/x.mjs": "x\n" });
    const { ran, runCheck } = checks();

    const outcome = await commitFix({
      root: repo.clone,
      fixed: [{ number: 12, summary: "Added .github/workflows/é.yml and .Claude/hooks/x.mjs." }],
      runCheck,
      bundle: join(repo.dir, "fix.bundle"),
    });

    expect(outcome).toEqual({
      status: "forbidden",
      paths: [".Claude/hooks/x.mjs", ".github/workflows/é.yml"],
      dropped: [],
    });
    expect(ran).toEqual([]);
  });

  it("refuses a Markdown block the fix repeated, as 03b41a8 did to CLAUDE.md", async () => {
    const section =
      "### Friction reports\n\nReport every friction you hit as a GitHub issue labelled friction.\n";
    await repo.commit({ files: { "CLAUDE.md": `# CLAUDE.md\n\n${section}` } });
    await repo.write({ "CLAUDE.md": `# CLAUDE.md\n\n${section}\n${section}` });
    const { ran, runCheck } = checks();

    const outcome = await commitFix({
      root: repo.clone,
      fixed: [{ number: 12, summary: "Fixed CLAUDE.md." }],
      runCheck,
      bundle: join(repo.dir, "fix.bundle"),
    });

    expect(outcome).toEqual({
      status: "duplicated",
      path: "CLAUDE.md",
      line: "Report every friction you hit as a GitHub issue labelled friction.",
      dropped: [],
    });
    expect(ran).toEqual([]);
  });

  it("lets a fix move a Markdown line", async () => {
    await repo.commit({
      files: { "docs/a.md": "First, a line long enough to count as prose.\n\nSecond line.\n" },
    });
    await repo.write({
      "docs/a.md": "Second line.\n\nFirst, a line long enough to count as prose.\n",
    });
    const { runCheck } = checks();

    const outcome = await commitFix({
      root: repo.clone,
      fixed: [{ number: 12, summary: "Reordered docs/a.md." }],
      runCheck,
      bundle: join(repo.dir, "fix.bundle"),
    });

    expect(outcome).toMatchObject({ status: "committed", files: ["docs/a.md"] });
  });

  it("says so when there's nothing to commit", async () => {
    const { ran, runCheck } = checks();

    const outcome = await commitFix({
      root: repo.clone,
      fixed: [{ number: 12, summary: "Fixed it." }],
      runCheck,
      bundle: join(repo.dir, "fix.bundle"),
    });

    expect(outcome).toEqual({ status: "no_changes", dropped: [] });
    expect(ran).toEqual([]);
  });

  it("commits nothing when the fixer fixed no report, whatever it changed", async () => {
    await repo.write({ "README.md": "changed\n" });
    const { ran, runCheck } = checks();

    const outcome = await commitFix({
      root: repo.clone,
      fixed: [],
      runCheck,
      bundle: join(repo.dir, "fix.bundle"),
    });

    expect(outcome).toEqual({ status: "no_changes", dropped: [] });
    expect(ran).toEqual([]);
  });

  it("on a dry run lists what it would commit and changes nothing", async () => {
    await repo.write({ "README.md": "fixed\n", "scratch.ts": "x\n" });
    const { ran, runCheck } = checks();

    const outcome = await commitFix({
      root: repo.clone,
      fixed: [{ number: 12, summary: "Fixed README.md." }],
      runCheck,
      bundle: join(repo.dir, "fix.bundle"),
      dryRun: true,
    });

    expect(outcome).toEqual({
      status: "would_commit",
      files: ["README.md"],
      dropped: ["scratch.ts"],
    });
    expect(ran).toEqual([]);
    expect(await readFile(join(repo.clone, "scratch.ts"), "utf8")).toBe("x\n");
    expect(await repo.git(["diff", "--cached", "--name-only"])).toBe("");
  });
});
