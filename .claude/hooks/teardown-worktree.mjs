#!/usr/bin/env node
// PreToolUse(ExitWorktree|Bash) hook: before a worktree is removed, tear down its dev environment
// (`pnpm dev:teardown`: its `pnpm dev` server, its database and its Redis keys on the verification
// services), so nothing outlives the worktree. It runs on
//
//   - ExitWorktree with `action: "remove"`, for the worktree the session is in
//   - Bash `git [-C <dir>] worktree remove [<options>] <path>`
//
// When the teardown fails, it denies the removal with the teardown's own report, so a worktree
// never disappears while its resources live on; fix the cause (or run `pnpm dev:teardown` by hand)
// and remove it again. A checkout without `packages/dev-env` (before it merged) has nothing to tear
// down. `pnpm dev:prune` catches removals that bypass this (a manual `rm -rf`, a session's exit
// prompt). Output goes to stderr: it's for the transcript, not the model.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const { tool_name: tool, tool_input: args = {}, cwd } = JSON.parse(readFileSync(0, "utf8"));

const git = (dir, ...a) => {
  try {
    return execFileSync("git", ["-C", dir, ...a], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};

// The root of the linked worktree `dir` is in, or null in the main checkout or outside a repo.
function linkedWorktree(dir) {
  const gitDir = git(dir, "rev-parse", "--path-format=absolute", "--git-dir");
  const common = git(dir, "rev-parse", "--path-format=absolute", "--git-common-dir");
  return gitDir && gitDir !== common ? git(dir, "rev-parse", "--show-toplevel") : null;
}

// Splits a shell command into words and the operators between commands, honouring quotes. Enough
// for `git worktree remove` lines; anything fancier (variables, substitutions) isn't recognised.
function tokenize(command) {
  const tokens = [];
  let word = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === "'" || c === '"') {
      const end = command.indexOf(c, i + 1);
      word = (word ?? "") + command.slice(i + 1, end === -1 ? undefined : end);
      i = end === -1 ? command.length : end;
    } else if (/[;&|\n]/.test(c)) {
      if (word !== null) tokens.push(word);
      word = null;
      tokens.push({ op: c });
    } else if (/\s/.test(c)) {
      if (word !== null) tokens.push(word);
      word = null;
    } else {
      word = (word ?? "") + c;
    }
  }
  if (word !== null) tokens.push(word);
  return tokens;
}

// The absolute paths every `git worktree remove` in `command` removes.
function removedWorktrees(command) {
  const segments = [[]];
  for (const token of tokenize(command)) {
    if (typeof token === "string") segments.at(-1).push(token);
    else segments.push([]);
  }
  const paths = [];
  for (const words of segments) {
    if (words[0] !== "git") continue;
    let base = cwd;
    let i = 1;
    // git's own options: -C <dir> moves the base; -c <key=value> takes a value too.
    for (; i < words.length && words[i].startsWith("-"); i++) {
      if (words[i] === "-C") base = resolve(base, words[++i] ?? ".");
      else if (words[i] === "-c") i++;
    }
    if (words[i] !== "worktree" || words[i + 1] !== "remove") continue;
    const path = words.slice(i + 2).find((word) => !word.startsWith("-"));
    if (path) paths.push({ path: resolve(base, path), base });
  }
  return paths;
}

let targets = [];
if (tool === "ExitWorktree" && args.action === "remove") {
  const top = linkedWorktree(cwd);
  if (top) targets = [{ path: top, base: top }];
} else if (tool === "Bash") {
  targets = removedWorktrees(args.command ?? "");
}

const failures = [];
for (const { path, base } of targets) {
  const common = git(base, "rev-parse", "--path-format=absolute", "--git-common-dir");
  if (!common) continue;
  const main = dirname(common);
  const script = join(main, "packages/dev-env/src/cli/teardown.ts");
  if (!existsSync(script)) continue;
  try {
    const out = execFileSync("node", [script, "--worktree", path], {
      cwd: main,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 50_000,
    });
    process.stderr.write(out);
  } catch (error) {
    const report = [error.stderr, error.stdout].filter(Boolean).join("").trim();
    failures.push(`${path}: ${report || error.message}`);
  }
}

if (failures.length > 0) {
  const reason = [
    "The worktree's dev environment couldn't be torn down, so it wasn't removed (its database or",
    "Redis keys would outlive it).",
    ...failures,
    "Fix the cause, run `pnpm dev:teardown` in the worktree until it succeeds, then remove it again.",
  ].join(" ");
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
}
