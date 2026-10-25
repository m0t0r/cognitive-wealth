#!/usr/bin/env node
// Sweeps away what removed worktrees left behind: runs `pnpm dev:prune`, which tears down the dev
// environment (its `pnpm dev`, its database and Redis keys on the verification services) of every
// worktree git no longer lists. The sweep only touches worktrees that are gone, so it's safe at
// any time, and it runs at every point a worktree can have gone:
//
//   - PostToolUse(ExitWorktree) with `action: "remove"`, and PostToolUse(Bash) after
//     `git [-C <dir>] worktree remove|prune`. Post, not Pre: a removal that's declined or refused
//     (uncommitted changes) keeps its data. A failed sweep is reported to Claude, to retry.
//   - SessionEnd and SessionStart: Claude Code has no hook for the exit prompt's removal or a
//     subagent worktree's cleanup, so the next session edge catches those, and `rm -rf` too.
//     SessionStart sweeps in the background, so it never delays a session.
//
// Only this project's own `pnpm dev:prune` runs (from the main checkout, found through
// CLAUDE_PROJECT_DIR), never a script named by the command. A checkout without
// `packages/dev-env` (before it merged) has nothing to sweep. `pnpm dev` sweeps on start too.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const input = JSON.parse(readFileSync(0, "utf8"));
const { hook_event_name: event, tool_name: tool, tool_input: args = {} } = input;

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

// Splits a shell command into words and the operators between commands, honouring quotes. Enough
// to recognise `git worktree remove`; anything fancier (variables, substitutions) isn't.
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

// Whether `command` runs `git [<options>] worktree remove|prune` as one of its commands.
function removesWorktrees(command) {
  const segments = [[]];
  for (const token of tokenize(command)) {
    if (typeof token === "string") segments.at(-1).push(token);
    else segments.push([]);
  }
  return segments.some((words) => {
    if (words[0] !== "git") return false;
    let i = 1;
    // git's own options; -C <dir> and -c <key=value> take a value.
    for (; i < words.length && words[i].startsWith("-"); i++) {
      if (words[i] === "-C" || words[i] === "-c") i++;
    }
    return words[i] === "worktree" && ["remove", "prune"].includes(words[i + 1]);
  });
}

const wanted =
  event === "SessionStart" ||
  event === "SessionEnd" ||
  (event === "PostToolUse" && tool === "ExitWorktree" && args.action === "remove") ||
  (event === "PostToolUse" && tool === "Bash" && removesWorktrees(args.command ?? ""));
if (!wanted) process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? resolve(import.meta.dirname, "../..");
const common = git(projectDir, "rev-parse", "--path-format=absolute", "--git-common-dir");
const main = common && dirname(common);
const script = main && join(main, "packages/dev-env/src/cli/prune.ts");
if (!script || !existsSync(script)) process.exit(0);

if (event === "SessionStart") {
  // Detached and unwaited, so the session starts at once; the next session edge retries a failure.
  spawn("node", [script], { cwd: main, detached: true, stdio: "ignore" }).unref();
  process.exit(0);
}

try {
  const out = execFileSync("node", [script], {
    cwd: main,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 50_000,
  });
  process.stderr.write(out);
} catch (error) {
  const report = [error.stderr, error.stdout].filter(Boolean).join("").trim() || error.message;
  // The main checkout pulled a dependency it never installed (a fast-forward doesn't install).
  const fix = /ERR_MODULE_NOT_FOUND/.test(report)
    ? `The main checkout's dependencies aren't installed: ask the user to run ` +
      `\`! pnpm -C ${main} install --frozen-lockfile\`, then run`
    : "Fix the cause, then run";
  if (event === "PostToolUse") {
    // The removal already happened; `block` hands the reason to Claude so it retries the sweep.
    console.log(
      JSON.stringify({
        decision: "block",
        reason:
          "The worktree is removed, but its dev environment couldn't be torn down, so its " +
          `database or Redis keys are still there: ${report} ${fix} ` +
          "`pnpm dev:prune` from the main checkout until it succeeds.",
      }),
    );
  } else {
    process.stderr.write(`pnpm dev:prune failed: ${report}\n${fix} \`pnpm dev:prune\`.\n`);
  }
}
