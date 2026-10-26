import { execFileSync, spawnSync } from "node:child_process";
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
import { setTimeout as sleep } from "node:timers/promises";
import { test as base } from "vitest";

const HOOK = join(import.meta.dirname, "teardown-worktree.mjs");

interface Layout {
  /** The main checkout of a throwaway repo, with a stand-in `pnpm dev:prune`. */
  main: string;
  /** A linked worktree of it, where the real ones live (`.claude/worktrees/<name>`). */
  worktree: string;
  /** Where the stand-in sweep logs each call: its arguments and working directory. */
  calls: string;
}

// The stand-in for packages/cli/src/cli.ts (`cw dev prune --json`): logs the call, then answers
// the way the real one does, JSON on stdout and exit 1 for a failure the test asks for.
const FAKE_CW = `
import { appendFileSync } from "node:fs";
appendFileSync(process.env.PRUNE_CALLS, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + "\\n");
const answer = (output, code = 0) => {
  console.log(JSON.stringify(output));
  process.exitCode = code;
};
// A checkout that pulled a new dependency but never ran pnpm install: cw itself can't load.
if (process.env.PRUNE_UNINSTALLED) await import("incur");
else if (process.env.PRUNE_FAIL) {
  answer({ code: "prune_failed", message: "Tore down 0, and failed on:\\nTeardown of wt_task failed to drop the database: permission denied", retryable: true }, 1);
} else if (process.env.PRUNE_MISSING_MODULE) {
  // cw loaded, but a module a command imports when it runs didn't.
  answer({ code: "ERR_MODULE_NOT_FOUND", message: "Cannot find package 'postgres'", retryable: false }, 1);
} else {
  answer({ dryRun: false, removed: process.env.PRUNE_REMOVED ? ["wt_gone: dropped"] : [], orphans: [], servers: [] });
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
  const src = join(main, "packages/cli/src");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "cli.ts"), FAKE_CW);
  // An installed main checkout; SessionStart warns without it.
  mkdirSync(join(main, "packages/cli/node_modules"));
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

type Call = { args: string[]; cwd: string };

function callsIn(file: string): Call[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((line): Call => JSON.parse(line));
}

type RunArgs = {
  layout: Layout;
  event: "PostToolUse" | "SessionStart" | "SessionEnd";
  cwd?: string;
  tool?: string;
  input?: Record<string, string>;
  fail?: boolean;
  uninstalled?: boolean;
  missingModule?: boolean;
  removed?: boolean;
};

/** Runs the hook; returns what it printed and the sweeps it ran. */
function run({
  layout,
  event,
  cwd = layout.main,
  tool,
  input,
  fail = false,
  uninstalled = false,
  missingModule = false,
  removed = false,
}: RunArgs) {
  const result = spawnSync("node", [HOOK], {
    input: JSON.stringify({
      hook_event_name: event,
      tool_name: tool,
      tool_input: input,
      cwd,
    }),
    env: gitFreeEnv({
      CLAUDE_PROJECT_DIR: layout.main,
      PRUNE_CALLS: layout.calls,
      ...(fail ? { PRUNE_FAIL: "1" } : {}),
      ...(uninstalled ? { PRUNE_UNINSTALLED: "1" } : {}),
      ...(missingModule ? { PRUNE_MISSING_MODULE: "1" } : {}),
      ...(removed ? { PRUNE_REMOVED: "1" } : {}),
    }),
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`The hook exited ${result.status}: ${result.stderr}`);
  return { out: result.stdout, stderr: result.stderr, calls: callsIn(layout.calls) };
}

const sweptFromMain = (layout: Layout): Call[] => [
  { args: ["dev", "prune", "--json"], cwd: layout.main },
];

describe("after ExitWorktree", () => {
  test("sweeps once the worktree is removed", ({ layout }) => {
    const { out, calls } = run({
      layout,
      event: "PostToolUse",
      cwd: layout.worktree,
      tool: "ExitWorktree",
      input: { action: "remove" },
    });
    expect(calls).toEqual(sweptFromMain(layout));
    expect(out).toBe("");
  });

  test("leaves a kept worktree's environment alone", ({ layout }) => {
    const { calls } = run({
      layout,
      event: "PostToolUse",
      cwd: layout.worktree,
      tool: "ExitWorktree",
      input: { action: "keep" },
    });
    expect(calls).toEqual([]);
  });

  test("tells Claude when the sweep fails, with what failed", ({ layout }) => {
    const { out } = run({
      layout,
      event: "PostToolUse",
      cwd: layout.worktree,
      tool: "ExitWorktree",
      input: { action: "remove" },
      fail: true,
    });
    expect(JSON.parse(out)).toMatchObject({ decision: "block" });
    expect(out).toContain("failed to drop the database: permission denied");
    expect(out).toContain("pnpm dev:prune");
  });

  test.for([
    { name: "cw itself can't load", uninstalled: true },
    { name: "cw reports ERR_MODULE_NOT_FOUND", missingModule: true },
  ])("names the install when $name", ({ uninstalled, missingModule }, { layout }) => {
    const { out } = run({
      layout,
      event: "PostToolUse",
      cwd: layout.worktree,
      tool: "ExitWorktree",
      input: { action: "remove" },
      uninstalled,
      missingModule,
    });
    expect(JSON.parse(out)).toMatchObject({ decision: "block" });
    expect(out).toContain(`pnpm -C ${layout.main} install --frozen-lockfile`);
  });

  test("passes on what it tore down, read from cw's fields", ({ layout }) => {
    const { out, stderr } = run({
      layout,
      event: "PostToolUse",
      tool: "ExitWorktree",
      input: { action: "remove" },
      removed: true,
    });
    expect(out).toBe("");
    expect(stderr).toBe("Tore down what was left of removed worktrees:\n  wt_gone: dropped\n");
  });
});

describe("after a git worktree command", () => {
  test.for([
    "git worktree remove .claude/worktrees/task",
    "git worktree remove --force .claude/worktrees/task",
    "git -C /elsewhere worktree remove x",
    'git worktree remove ".claude/worktrees/task" && git branch -D task',
    "git worktree list; git worktree remove .claude/worktrees/task",
    "git worktree prune",
  ])("sweeps after %s", (command, { layout }) => {
    const { calls } = run({ layout, event: "PostToolUse", tool: "Bash", input: { command } });
    expect(calls).toEqual(sweptFromMain(layout));
  });

  test.for(["git worktree list", "git worktree add x", "echo git worktree remove", "ls"])(
    "doesn't sweep after %s",
    (command, { layout }) => {
      const { calls } = run({ layout, event: "PostToolUse", tool: "Bash", input: { command } });
      expect(calls).toEqual([]);
    },
  );
});

describe("at the edges of a session", () => {
  test("sweeps when a session ends, which catches the exit prompt's removal", ({ layout }) => {
    expect(run({ layout, event: "SessionEnd" }).calls).toEqual(sweptFromMain(layout));
  });

  test("sweeps in the background when a session starts", async ({ layout }) => {
    expect(run({ layout, event: "SessionStart" }).out).toBe("");
    const deadline = Date.now() + 10_000;
    while (callsIn(layout.calls).length === 0 && Date.now() < deadline) {
      // oxlint-disable-next-line no-await-in-loop -- polling for the detached sweep
      await sleep(50);
    }
    expect(callsIn(layout.calls)).toEqual(sweptFromMain(layout));
  });

  test("tells the next session when the sweep at a session's end failed", ({ layout }) => {
    run({ layout, event: "SessionEnd", fail: true });
    const { out } = run({ layout, event: "SessionStart" });
    expect(contextOf(out)).toContain("failed to drop the database: permission denied");
    expect(contextOf(out)).toContain("pnpm dev:prune");
  });

  test("records a failed background sweep for the next session", async ({ layout }) => {
    run({ layout, event: "SessionStart", fail: true });
    const recorded = join(layout.main, ".dev/worktree-env/sweep-failed.txt");
    const deadline = Date.now() + 10_000;
    while (!existsSync(recorded) && Date.now() < deadline) {
      // oxlint-disable-next-line no-await-in-loop -- polling for the detached sweep
      await sleep(50);
    }
    expect(readFileSync(recorded, "utf8")).toContain("permission denied");
  });

  test("forgets a failure once a sweep succeeds", ({ layout }) => {
    run({ layout, event: "SessionEnd", fail: true });
    run({ layout, event: "PostToolUse", tool: "ExitWorktree", input: { action: "remove" } });
    expect(run({ layout, event: "SessionStart" }).out).toBe("");
  });

  test("says at once when the main checkout isn't installed", ({ layout }) => {
    rmSync(join(layout.main, "packages/cli/node_modules"), { recursive: true });
    const { out } = run({ layout, event: "SessionStart" });
    expect(contextOf(out)).toContain(`pnpm -C ${layout.main} install --frozen-lockfile`);
  });
});

/** The `additionalContext` a SessionStart hook printed. */
function contextOf(out: string): string {
  const parsed: { hookSpecificOutput: { hookEventName: string; additionalContext: string } } =
    JSON.parse(out);
  expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
  return parsed.hookSpecificOutput.additionalContext;
}

test("does nothing in a checkout without pnpm dev:prune yet", ({ layout }) => {
  rmSync(join(layout.main, "packages"), { recursive: true });
  const { out, calls } = run({
    layout,
    event: "PostToolUse",
    tool: "ExitWorktree",
    input: { action: "remove" },
  });
  expect(out).toBe("");
  expect(calls).toEqual([]);
});
