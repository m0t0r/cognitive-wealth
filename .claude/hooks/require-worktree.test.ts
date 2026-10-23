import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base } from "vitest";

const HOOK = join(import.meta.dirname, "require-worktree.mjs");

interface Layout {
  /** The main checkout of a throwaway repo. */
  main: string;
  /** A linked worktree of it, where the real ones live (`.claude/worktrees/<name>`). */
  worktree: string;
  /** A directory outside the repo, standing in for Claude Code's scratchpad. */
  outside: string;
}

// Each test gets its own repo, so none can see another's files. Vitest requires a destructuring
// pattern as the fixture's first argument.
// oxlint-disable-next-line no-empty-pattern
const test = base.extend("layout", async ({}, { onCleanup }): Promise<Layout> => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "require-worktree-")));
  onCleanup(() => rmSync(root, { recursive: true, force: true }));
  const main = join(root, "main");
  const worktree = join(main, ".claude/worktrees/task");
  const outside = join(root, "scratchpad");
  mkdirSync(outside);
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
  return { main, worktree, outside };
});

// The process env without GIT_* variables, which a surrounding git hook would point at this repo.
function gitFreeEnv(extra: Record<string, string> = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  delete env.CLAUDE_MAIN_CHECKOUT;
  return { ...env, ...extra };
}

function git(...args: string[]) {
  execFileSync("git", args, { env: gitFreeEnv(), stdio: "ignore" });
}

function decide(
  cwd: string,
  tool: string,
  input: Record<string, string>,
  env?: Record<string, string>,
) {
  const out = execFileSync("node", [HOOK], {
    input: JSON.stringify({ tool_name: tool, tool_input: input, cwd }),
    env: gitFreeEnv(env),
    encoding: "utf8",
  });
  return out.includes('"deny"') ? "deny" : "allow";
}

const bash = (command: string) => ["Bash", { command }] as const;

describe("from the main checkout", () => {
  test.for([
    "cat CLAUDE.md",
    "sed -n 1,5p CLAUDE.md",
    "sed -E 's/x/y/' CLAUDE.md",
    "sed -n 1,5p CLAUDE.md | grep -i foo",
    "sed -n 1p CLAUDE.md; find . -print",
    "sed -n 1p CLAUDE.md && rg -i foo",
    "git log --oneline",
    "git pull --ff-only",
    "git merge --ff-only origin/dev",
    "gh pr view 1",
  ])("allows %s", (command, { layout }) => {
    expect(decide(layout.main, ...bash(command))).toBe("allow");
  });

  test.for([
    "git commit -m x",
    "git add .",
    "git switch -c feat/x",
    "git pull --ff-only && git commit -m x",
    "pnpm add left-pad",
    "sed -i '' 's/x/y/' CLAUDE.md",
    "sed -Ei 's/x/y/' CLAUDE.md",
    "sed 's/x/y/' -i CLAUDE.md",
    "sed --in-place 's/x/y/' CLAUDE.md",
    "perl -pi -e 's/x/y/' CLAUDE.md",
    "git grep -l foo | xargs sed -i '' 's/foo/bar/'",
    // A `;` or `|` in the quoted script doesn't hide a trailing -i.
    "sed 's/a;b/c/' -i CLAUDE.md",
    "sed 's/a|b/c/' -i CLAUDE.md",
    'sed "s/a;b/c/" --in-place CLAUDE.md',
    // Nor does wrapping the whole command in quotes.
    "sh -c \"sed -i '' 's/x/y/' CLAUDE.md\"",
  ])("denies %s", (command, { layout }) => {
    expect(decide(layout.main, ...bash(command))).toBe("deny");
  });

  test("denies an in-place rewrite whatever its target", ({ layout }) => {
    expect(decide(layout.main, ...bash(`sed -i '' 's/x/y/' ${layout.outside}/scan.rb`))).toBe(
      "deny",
    );
  });

  test("denies Edit and Write inside it, with the fix in the reason", ({ layout }) => {
    expect(decide(layout.main, "Edit", { file_path: join(layout.main, "CLAUDE.md") })).toBe("deny");
    expect(decide(layout.main, "Write", { file_path: "docs/new.md" })).toBe("deny");
    const out = execFileSync("node", [HOOK], {
      input: JSON.stringify({
        tool_name: "Edit",
        tool_input: { file_path: "CLAUDE.md" },
        cwd: layout.main,
      }),
      env: gitFreeEnv(),
      encoding: "utf8",
    });
    expect(JSON.parse(out).hookSpecificOutput.permissionDecisionReason).toContain("EnterWorktree");
  });

  test("allows Edit and Write outside the repo", ({ layout }) => {
    expect(decide(layout.main, "Write", { file_path: join(layout.outside, "scan.rb") })).toBe(
      "allow",
    );
    expect(
      decide(layout.main, "Edit", { file_path: join(layout.outside, "new/dir/file.md") }),
    ).toBe("allow");
  });

  test("allows everything with CLAUDE_MAIN_CHECKOUT=1", ({ layout }) => {
    expect(decide(layout.main, ...bash("git commit -m x"), { CLAUDE_MAIN_CHECKOUT: "1" })).toBe(
      "allow",
    );
  });
});

describe("from a linked worktree", () => {
  test.for([
    "git commit -m x",
    "sed -i '' 's/x/y/' CLAUDE.md",
    "sed -i '' 's/x/y/' .dev/scratch/scan.rb",
    "sh .dev/scratch/run.sh",
    "pnpm add left-pad",
  ])("allows %s", (command, { layout }) => {
    expect(decide(layout.worktree, ...bash(command))).toBe("allow");
  });

  test("allows Write to its .dev/scratch/", ({ layout }) => {
    const file = join(layout.worktree, ".dev/scratch/run.sh");
    expect(decide(layout.worktree, "Write", { file_path: file })).toBe("allow");
  });
});

test("allows Bash run from outside the repo", ({ layout }) => {
  expect(decide(layout.outside, ...bash("sed -i '' 's/x/y/' scan.rb"))).toBe("allow");
});
