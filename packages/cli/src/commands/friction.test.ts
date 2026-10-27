// `cw friction …`'s wiring: options, output, codes and exit status, on issues in memory and a canned
// Claude. The triage and gathering rules are `@repo/friction-bot`'s, tested there.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { git, type TempRepo, tempRepo } from "@repo/friction-bot/testing/git-repo";
import { memoryGitHub, pullRequest, report } from "@repo/friction-bot/testing/memory-github";
import { CliError } from "@repo/db/cli/cli-error";
import type { Claude } from "../dependencies";
import { createCli } from "../app";
import { dependencies, run } from "../testing";

type SetupArgs = { issues?: ReturnType<typeof report>[]; claude?: Claude };

function setup({ issues = [report({ number: 12 })], claude }: SetupArgs = {}) {
  const { github, writes } = memoryGitHub(issues);
  const cli = createCli(
    dependencies({
      github: async () => github,
      ...(claude ? { claude: async () => claude } : {}),
    }),
  );
  return { cli, writes };
}

const sections = ["--what", "It broke", "--cost", "10 minutes", "--where", "CLAUDE.md"];

const claude = (overrides: Partial<Claude> = {}): Claude => ({
  triage: vi.fn(async () => ({
    decision: "ready-for-agent" as const,
    duplicate_of: null,
    fixed_in: null,
    reason: "A doc fix.",
    brief: null,
    checked: [],
  })),
  fix: vi.fn(async () => ({
    result: {
      fixed: [{ number: 12, summary: "Fixed CLAUDE.md." }],
      skipped: [{ number: 99, reason: "Not asked for." }],
      friction: [1, 2, 3, 4].map((n) => ({
        title: `Friction ${n}`,
        what: "w",
        cost: "c",
        where: "x",
        fix: "",
      })),
    },
    steps: 7,
    costUsd: 0.42,
  })),
  ...overrides,
});

describe("cw friction search", () => {
  it("lists matching reports and suggests adding an occurrence to the first open one", async () => {
    const { cli } = setup({
      issues: [
        report({ number: 12, title: "Heredoc refused" }),
        report({ number: 13, title: "Something else" }),
      ],
    });
    const { output, exitCode } = await run({ cli, argv: ["friction", "search", "heredoc"] });
    expect(exitCode).toBe(0);
    expect(output).toMatchObject({
      reports: [{ number: 12, title: "Heredoc refused", state: "open", labels: ["friction"] }],
      cta: { commands: [{ command: "pnpm cw friction report --on 12" }, {}] },
    });
  });
});

describe("cw friction report", () => {
  it("shows the body on a dry run and sends nothing, with the real command as its CTA", async () => {
    const { cli, writes } = setup();
    const { output, exitCode } = await run({
      cli,
      argv: ["friction", "report", "--title", "Lint fails", ...sections, "--dry-run"],
    });
    expect(exitCode).toBe(0);
    expect(output).toMatchObject({
      dryRun: true,
      action: "created",
      number: null,
      body: "## What happened\nIt broke\n\n## Cost\n10 minutes\n\n## Where\nCLAUDE.md",
      cta: {
        commands: [
          {
            command:
              "pnpm cw friction report --title 'Lint fails' --what 'It broke' --cost '10 minutes' --where CLAUDE.md",
          },
        ],
      },
    });
    expect(writes).toEqual([]);
  });

  it("files a report with the friction label", async () => {
    const { cli, writes } = setup();
    const { output } = await run({
      cli,
      argv: ["friction", "report", "--title", "Lint fails", ...sections],
    });
    expect(output).toMatchObject({ dryRun: false, action: "created", number: 13 });
    expect(writes).toMatchObject([{ kind: "create", title: "Lint fails", labels: ["friction"] }]);
  });

  it("adds an occurrence with --on", async () => {
    const { cli, writes } = setup();
    const { output } = await run({ cli, argv: ["friction", "report", "--on", "12", ...sections] });
    expect(output).toMatchObject({ action: "commented", number: 12, title: "Report 12" });
    expect(writes).toMatchObject([{ kind: "comment", number: 12 }]);
  });

  it.for([
    { name: "no title", argv: [...sections], code: "invalid_input" },
    { name: "a missing section", argv: ["--title", "T", "--what", "x"], code: "invalid_input" },
    {
      name: "--body-file beside the sections",
      argv: ["--title", "T", "--body-file", "body.md", ...sections],
      code: "invalid_input",
    },
  ])("refuses $name", async ({ argv, code }) => {
    const { cli, writes } = setup();
    const { output, exitCode } = await run({ cli, argv: ["friction", "report", ...argv] });
    expect(exitCode).toBe(1);
    expect(output).toMatchObject({ code });
    expect(writes).toEqual([]);
  });

  it("refuses --on an issue that isn't a friction report", async () => {
    const { cli } = setup({ issues: [report({ number: 12, labels: ["bug"] })] });
    const { output } = await run({ cli, argv: ["friction", "report", "--on", "12", ...sections] });
    expect(output).toMatchObject({ code: "not_a_friction_report" });
  });
});

describe("cw friction triage", () => {
  it("applies the decision and lists what it did", async () => {
    const { cli, writes } = setup({ claude: claude() });
    const { output, exitCode } = await run({ cli, argv: ["friction", "triage", "12"] });
    expect(exitCode).toBe(0);
    expect(output).toMatchObject({
      issue: 12,
      status: "triaged",
      decision: "ready-for-agent",
      dryRun: false,
      actions: [{ kind: "label", add: ["ready-for-agent"] }, { kind: "comment" }],
    });
    expect(writes).toHaveLength(2);
  });

  it("closes an already-fixed report", async () => {
    const triage = vi.fn(async () => ({
      decision: "already-fixed" as const,
      duplicate_of: null,
      fixed_in: "CLAUDE.md, the packages/cli bullet",
      reason: "It's there.",
      brief: null,
      checked: ["`CLAUDE.md`"],
    }));
    const { cli, writes } = setup({ claude: claude({ triage }) });
    const { output, exitCode } = await run({ cli, argv: ["friction", "triage", "12"] });
    expect(exitCode).toBe(0);
    expect(output).toMatchObject({
      decision: "already-fixed",
      actions: [{ kind: "label", add: ["wontfix"] }, { kind: "close" }],
    });
    expect(writes).toHaveLength(2);
  });

  it("writes nothing on a dry run, and suggests applying it", async () => {
    const { cli, writes } = setup({ claude: claude() });
    const { output } = await run({ cli, argv: ["friction", "triage", "12", "--dry-run"] });
    expect(output).toMatchObject({
      dryRun: true,
      cta: { commands: [{ command: "pnpm cw friction triage 12" }] },
    });
    expect(writes).toEqual([]);
  });

  it("passes the API's refusal on with its code and retryable", async () => {
    const refused = Object.assign(new Error("Credit balance is too low"), {
      code: "anthropic_api_error",
      retryable: false,
    });
    const { cli } = setup({
      claude: claude({ triage: vi.fn(() => Promise.reject(refused)) }),
    });
    const { output, exitCode } = await run({ cli, argv: ["friction", "triage", "12"] });
    expect(exitCode).toBe(1);
    expect(output).toMatchObject({
      code: "anthropic_api_error",
      message: "Credit balance is too low",
      retryable: false,
    });
  });

  it("refuses without an API key as no_api_key", async () => {
    const { github } = memoryGitHub([report({ number: 12 })]);
    const cli = createCli(
      dependencies({
        github: async () => github,
        claude: () =>
          Promise.reject(
            new CliError({ code: "no_api_key", message: "ANTHROPIC_API_KEY isn't set." }),
          ),
      }),
    );
    const { output } = await run({ cli, argv: ["friction", "triage", "12"] });
    expect(output).toMatchObject({ code: "no_api_key" });
  });
});

describe("cw friction fix", () => {
  it("lists the reports on a dry run without calling Claude", async () => {
    const { cli } = setup();
    const { output, exitCode } = await run({ cli, argv: ["friction", "fix", "12", "--dry-run"] });
    expect(exitCode).toBe(0);
    expect(output).toMatchObject({
      dryRun: true,
      reports: [{ number: 12, title: "Report 12" }],
      cta: { commands: [{ command: "pnpm cw friction fix 12" }] },
    });
  });

  it("returns only the reports it was asked to fix, and at most 3 of its own frictions", async () => {
    const fake = claude();
    const { cli } = setup({ claude: fake });
    const { output } = await run({
      cli,
      argv: [
        "friction",
        "fix",
        "12",
        "--max-steps",
        "20",
        "--max-cost-usd",
        "1",
        "--checkout",
        "/work",
      ],
    });
    expect(output).toMatchObject({
      dryRun: false,
      fixed: [{ number: 12 }],
      skipped: [],
      friction: [{ title: "Friction 1" }, { title: "Friction 2" }, { title: "Friction 3" }],
      steps: 7,
      costUsd: 0.42,
    });
    expect(fake.fix).toHaveBeenCalledWith(
      expect.objectContaining({ numbers: [12], maxSteps: 20, maxCostUsd: 1, root: "/work" }),
    );
  });
});

describe("cw friction triage-backlog", () => {
  it("triages the untriaged reports and lists what it decided", async () => {
    const { cli, writes } = setup({
      issues: [report({ number: 228, createdAt: "2026-10-20T10:00:00Z" })],
      claude: claude(),
    });
    const { output, exitCode } = await run({ cli, argv: ["friction", "triage-backlog"] });
    expect(exitCode).toBe(0);
    expect(output).toMatchObject({
      triaged: [{ issue: 228, decision: "ready-for-agent" }],
      failed: [],
      dryRun: false,
    });
    expect(writes).toHaveLength(2);
  });
});

describe("cw friction refresh", () => {
  it("keeps the reports waiting and asks on the PR when GitHub won't rebase it", async () => {
    const gh = memoryGitHub([report({ number: 12, labels: ["friction", "ready-for-agent"] })], {
      pullRequests: [pullRequest({ number: 261, behind: 8 })],
      fail: { rebasePullRequest: new Error("Merge conflict") },
    });
    const cli = createCli(dependencies({ github: async () => gh.github }));

    const { output, exitCode } = await run({
      cli,
      argv: ["friction", "refresh", "12", "--run-url", "https://github.test/runs/1"],
    });

    expect(exitCode).toBe(0);
    expect(output).toMatchObject({ status: "stale", pr: 261, asked: true, dryRun: false });
    expect(gh.issue(12).labels).toEqual(["friction", "ready-for-agent"]);
    expect(gh.writes).toMatchObject([{ kind: "comment-pr", number: 261 }]);
  });
});

describe("cw friction hand-back", () => {
  it("hands back the reports still ready-for-agent", async () => {
    const { cli, writes } = setup({
      issues: [
        report({ number: 12, labels: ["friction", "ready-for-agent"] }),
        report({ number: 13, labels: ["friction", "ready-for-human"] }),
      ],
    });
    const { output, exitCode } = await run({
      cli,
      argv: ["friction", "hand-back", "12", "13", "--run-url", "https://github.test/runs/1"],
    });
    expect(exitCode).toBe(0);
    expect(output).toMatchObject({ handedBack: [12], left: [13], dryRun: false });
    expect(writes).toMatchObject([
      { kind: "label", number: 12, add: ["ready-for-human"] },
      { kind: "comment", number: 12 },
    ]);
  });
});

describe("cw friction start, commit and publish", () => {
  const BRANCH = "chore/friction-autofix";
  const runUrl = ["--run-url", "https://github.test/runs/1"];
  let repo: TempRepo;
  let dir: string;
  let publisher: string;

  beforeEach(async () => {
    repo = await tempRepo();
    dir = join(repo.dir, "out");
    publisher = join(repo.dir, "publisher");
    await mkdir(dir);
    await git({ cwd: repo.dir, args: ["clone", "-q", repo.origin, publisher] });
  });

  afterEach(async () => {
    await repo.remove();
  });

  type CheckoutCliArgs = { checks?: () => Promise<{ exitCode: number; output: string }> };

  function checkoutCli({
    checks = async () => ({ exitCode: 0, output: "" }),
  }: CheckoutCliArgs = {}) {
    const gh = memoryGitHub([
      report({ number: 12, labels: ["friction", "ready-for-agent"] }),
      report({ number: 13, labels: ["friction", "ready-for-agent"] }),
    ]);
    const cli = createCli(
      dependencies({ github: async () => gh.github, checks: async () => checks }),
    );
    return { cli, ...gh };
  }

  const fixAnswer = {
    fixed: [{ number: 12, summary: "Fixed README.md." }],
    skipped: [{ number: 13, reason: "Needs .github/." }],
    friction: [],
  };

  it("starts the fix on dev, commits it, pushes it and opens the PR", async () => {
    const { cli, writes, issue } = checkoutCli();

    const started = await run({
      cli,
      argv: ["friction", "start", "--checkout", repo.clone],
    });
    expect(started.output).toMatchObject({ from: "base", branch: BRANCH });

    await repo.write({ "README.md": "fixed\n" });
    await writeFile(join(dir, "result.json"), JSON.stringify(fixAnswer));
    const committed = await run({
      cli,
      argv: ["friction", "commit", "12", "13", "--checkout", repo.clone, "--dir", dir],
    });
    expect(committed).toMatchObject({
      exitCode: 0,
      output: { status: "committed", files: ["README.md"] },
    });

    const published = await run({
      cli,
      argv: ["friction", "publish", "12", "13", "--dir", dir, "--checkout", publisher, ...runUrl],
    });
    expect(published).toMatchObject({
      exitCode: 0,
      output: {
        pushed: { stacked: false },
        pullRequest: { number: 14, created: true },
        errors: [],
        dryRun: false,
      },
    });
    expect(await git({ cwd: repo.origin, args: ["log", "-1", "--format=%s", BRANCH] })).toBe(
      "chore: address friction reports (#12)",
    );
    expect(writes.filter(({ kind }) => kind === "create-pr")).toHaveLength(1);
    expect(issue(12).labels).toEqual(["friction"]);
    expect(issue(13).labels).toEqual(["friction", "ready-for-human"]);
  });

  it("refuses a failed check with its code, and still records the outcome for publish", async () => {
    const { cli } = checkoutCli({ checks: async () => ({ exitCode: 1, output: "lint failed" }) });
    await repo.write({ "README.md": "fixed\n" });
    await writeFile(join(dir, "result.json"), JSON.stringify(fixAnswer));

    const { output, exitCode } = await run({
      cli,
      argv: ["friction", "commit", "12", "13", "--checkout", repo.clone, "--dir", dir],
    });

    expect(exitCode).toBe(1);
    expect(output).toMatchObject({ code: "checks_failed", message: /pnpm lint/ });
    expect(JSON.parse(await readFile(join(dir, "commit.json"), "utf8"))).toMatchObject({
      status: "checks_failed",
      check: "lint",
    });
  });

  it("stacks on the bot's open PR", async () => {
    await repo.git(["checkout", "-q", "-B", BRANCH, "origin/dev"]);
    await repo.commit({ files: { "earlier.md": "earlier\n" } });
    await repo.git(["push", "-q", "origin", BRANCH]);
    const gh = memoryGitHub([], { pullRequests: [pullRequest({ number: 261 })] });
    const cli = createCli(dependencies({ github: async () => gh.github }));

    const { output } = await run({
      cli,
      argv: ["friction", "start", "--checkout", repo.clone, "--dry-run"],
    });

    expect(output).toMatchObject({ from: "branch", commit: await repo.git(["rev-parse", "HEAD"]) });
  });

  it("refuses an answer of the wrong shape before writing anything", async () => {
    const { cli, writes } = checkoutCli();
    await writeFile(join(dir, "result.json"), JSON.stringify({ fixed: "everything" }));

    const { output, exitCode } = await run({
      cli,
      argv: ["friction", "publish", "12", "--dir", dir, "--checkout", publisher, ...runUrl],
    });

    expect(exitCode).toBe(1);
    expect(output).toMatchObject({ code: "invalid_answer" });
    expect(writes).toEqual([]);
  });
});
