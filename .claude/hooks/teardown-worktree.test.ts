import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base } from "vitest";

const HOOK = join(import.meta.dirname, "teardown-worktree.mjs");

interface Layout {
  /** The main checkout of a throwaway repo, with a stand-in `pnpm dev:teardown`. */
  main: string;
  /** A linked worktree of it, where the real ones live (`.claude/worktrees/<name>`). */
  worktree: string;
  /** Where the stand-in teardown logs each call: its arguments and working directory. */
  calls: string;
}

// The stand-in for packages/dev-env/src/cli/teardown.ts: logs the call, then fails when the test
// asks it to, the way the real one reports a step that failed.
const FAKE_TEARDOWN = `
import { appendFileSync } from "node:fs";
appendFileSync(process.env.TEARDOWN_CALLS, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + "\\n");
if (process.env.TEARDOWN_FAIL) {
  console.error("Teardown of wt_task failed to drop the database: permission denied");
  process.exitCode = 1;
}
`;

// Each test gets its own repo, so none can see another's files. Vitest requires a destructuring
// pattern as the fixture's first argument.
// oxlint-disable-next-line no-empty-pattern
const test = base.extend("layout", async ({}, { onCleanup }): Promise<Layout> => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "teardown-worktree-")));
  onCleanup(() => rmSync(root, { recursive: true, force: true }));
  const main = join(root, "main");
  const worktree = join(main, ".claude/worktrees/task");
  git("init", "-q", "-b", "dev", main);
  git(
    "-C",
    main,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "init",
  );
  git("-C", main, "worktree", "add", "-q", "-b", "task", worktree);
  const cli = join(main, "packages/dev-env/src/cli");
  mkdirSync(cli, { recursive: true });
  writeFileSync(join(cli, "teardown.ts"), FAKE_TEARDOWN);
  return { main, worktree, calls: join(root, "calls.log") };
});

// The process env without GIT_* variables, which a surrounding git hook would point at this repo.
function gitFreeEnv(extra: Record<string, string> = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  return { ...env, ...extra };
}

function git(...args: string[]) {
  execFileSync("git", args, { env: gitFreeEnv(), stdio: "ignore" });
}

type RunArgs = {
  layout: Layout;
  cwd: string;
  tool: string;
  input: Record<string, string>;
  fail?: boolean;
};

/** Runs the hook; returns its decision and the teardown calls it made. */
function run({ layout, cwd, tool, input, fail = false }: RunArgs) {
  const out = execFileSync("node", [HOOK], {
    input: JSON.stringify({ tool_name: tool, tool_input: input, cwd }),
    env: gitFreeEnv({
      CLAUDE_PROJECT_DIR: layout.main,
      TEARDOWN_CALLS: layout.calls,
      ...(fail ? { TEARDOWN_FAIL: "1" } : {}),
    }),
    encoding: "utf8",
  });
  const calls = existsSync(layout.calls)
    ? readFileSync(layout.calls, "utf8")
        .trim()
        .split("\n")
        .map((line): { args: string[]; cwd: string } => JSON.parse(line))
    : [];
  const decision = out.includes('"deny"') ? "deny" : "allow";
  return { decision, calls, out };
}

describe("ExitWorktree", () => {
  test("tears the worktree down before removing it", ({ layout }) => {
    const { decision, calls } = run({
      layout,
      cwd: layout.worktree,
      tool: "ExitWorktree",
      input: { action: "remove" },
    });
    expect(decision).toBe("allow");
    expect(calls).toEqual([{ args: ["--worktree", layout.worktree], cwd: layout.main }]);
  });

  test("leaves a kept worktree's environment alone", ({ layout }) => {
    const { decision, calls } = run({
      layout,
      cwd: layout.worktree,
      tool: "ExitWorktree",
      input: { action: "keep" },
    });
    expect(decision).toBe("allow");
    expect(calls).toEqual([]);
  });

  test("does nothing in the main checkout", ({ layout }) => {
    const { calls } = run({
      layout,
      cwd: layout.main,
      tool: "ExitWorktree",
      input: { action: "remove" },
    });
    expect(calls).toEqual([]);
  });

  test("denies the removal when teardown fails, with what failed", ({ layout }) => {
    const { decision, out } = run({
      layout,
      cwd: layout.worktree,
      tool: "ExitWorktree",
      input: { action: "remove" },
      fail: true,
    });
    expect(decision).toBe("deny");
    expect(out).toContain("failed to drop the database: permission denied");
    expect(existsSync(layout.worktree)).toBe(true);
  });
});

describe("git worktree remove", () => {
  test.for([
    "git worktree remove .claude/worktrees/task",
    "git worktree remove --force .claude/worktrees/task",
    "git worktree remove -f -f .claude/worktrees/task",
    "git worktree remove '.claude/worktrees/task'",
    'git worktree remove ".claude/worktrees/task" && git branch -D task',
    "git worktree list; git worktree remove .claude/worktrees/task",
  ])("tears the worktree down for %s", (command, { layout }) => {
    const { decision, calls } = run({ layout, cwd: layout.main, tool: "Bash", input: { command } });
    expect(decision).toBe("allow");
    expect(calls).toEqual([{ args: ["--worktree", layout.worktree], cwd: layout.main }]);
  });

  test("resolves the path against git -C", ({ layout }) => {
    const command = `git -C ${layout.main} worktree remove .claude/worktrees/task`;
    const { calls } = run({ layout, cwd: layout.worktree, tool: "Bash", input: { command } });
    expect(calls).toEqual([{ args: ["--worktree", layout.worktree], cwd: layout.main }]);
  });

  test("never runs another repo's teardown", ({ layout }) => {
    const other = join(layout.main, "..", "other");
    git("init", "-q", "-b", "dev", other);
    const cli = join(other, "packages/dev-env/src/cli");
    mkdirSync(cli, { recursive: true });
    writeFileSync(join(cli, "teardown.ts"), FAKE_TEARDOWN);
    const command = `git -C ${other} worktree remove some-worktree`;
    const { decision, calls } = run({ layout, cwd: layout.main, tool: "Bash", input: { command } });
    expect(decision).toBe("allow");
    expect(calls).toEqual([]);
  });

  test("denies the removal when teardown fails", ({ layout }) => {
    const { decision } = run({
      layout,
      cwd: layout.main,
      tool: "Bash",
      input: { command: "git worktree remove .claude/worktrees/task" },
      fail: true,
    });
    expect(decision).toBe("deny");
  });

  test.for(["git worktree list", "git worktree prune", "echo git worktree remove", "ls"])(
    "ignores %s",
    (command, { layout }) => {
      const { decision, calls } = run({
        layout,
        cwd: layout.main,
        tool: "Bash",
        input: { command },
      });
      expect(decision).toBe("allow");
      expect(calls).toEqual([]);
    },
  );
});

test("allows the removal when the checkout has no pnpm dev:teardown yet", ({ layout }) => {
  rmSync(join(layout.main, "packages"), { recursive: true });
  const { decision, calls } = run({
    layout,
    cwd: layout.worktree,
    tool: "ExitWorktree",
    input: { action: "remove" },
  });
  expect(decision).toBe("allow");
  expect(calls).toEqual([]);
});
