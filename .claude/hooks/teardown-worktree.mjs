#!/usr/bin/env node
// Sweeps away what removed worktrees left behind: runs `pnpm dev:prune` (`cw dev prune --json`,
// ADR 0026, whose fields it reads rather than its text), which tears down the dev
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
// Nobody sees a session edge's output (SessionStart's sweep is detached, SessionEnd's stderr goes
// nowhere), so those sweeps record a failure in the main checkout's
// `.dev/worktree-env/sweep-failed.txt`, and the next SessionStart hands it to Claude as
// `additionalContext`; any sweep that succeeds clears it. SessionStart also says at once when the
// main checkout has no `packages/cli/node_modules`, the usual cause (a pull without install).
//
// Only this project's own `pnpm dev:prune` runs (from the main checkout, found through
// CLAUDE_PROJECT_DIR), never a script named by the command. A checkout without `packages/cli`
// (before it merged) has nothing this hook can run. `pnpm dev` sweeps on start too.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// The detached SessionStart sweep: `teardown-worktree.mjs --record <main checkout>`.
if (process.argv[2] === "--record") {
  sweep({ main: process.argv[3], record: true });
  process.exit(0);
}

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

// Declarations, not arrow consts: `--record` above calls `sweep` before this line runs.
function failureFile(main) {
  return join(main, ".dev/worktree-env/sweep-failed.txt");
}

function installFix(main) {
  return (
    "The main checkout's dependencies aren't installed: ask the user to run " +
    `\`! pnpm -C ${main} install --frozen-lockfile\`, then run \`pnpm dev:prune\`.`
  );
}

function cliOf(main) {
  return join(main, "packages/cli/src/cli.ts");
}

function parsed(json) {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

// Runs the main checkout's `cw dev prune --json` (`pnpm dev:prune`). Returns null when it succeeds,
// or what failed and how to fix it. A session edge's sweep (`record`) keeps that for the next
// SessionStart; any success clears it.
function sweep({ main, record }) {
  try {
    const out = execFileSync("node", [cliOf(main), "dev", "prune", "--json"], {
      cwd: main,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 50_000,
    });
    const removed = parsed(out)?.removed ?? [];
    if (removed.length > 0) {
      process.stderr.write(
        `Tore down what was left of removed worktrees:\n  ${removed.join("\n  ")}\n`,
      );
    }
    rmSync(failureFile(main), { force: true });
    return null;
  } catch (error) {
    // `cw` reports a failure as JSON on stdout (`{ code, message }`); one that can't start, such
    // as a missing dependency of its own, leaves only Node's error on stderr.
    const reported = parsed(error.stdout ?? "");
    const report =
      reported?.message ??
      ([error.stderr, error.stdout].filter(Boolean).join("").trim() || error.message);
    // The main checkout pulled a dependency it never installed (a fast-forward doesn't install).
    const missing =
      reported?.code === "ERR_MODULE_NOT_FOUND" || /ERR_MODULE_NOT_FOUND/.test(error.stderr ?? "");
    const failure = missing
      ? `${report} ${installFix(main)}`
      : `${report} Fix the cause, then run \`pnpm dev:prune\` from the main checkout until it succeeds.`;
    if (record) {
      mkdirSync(dirname(failureFile(main)), { recursive: true });
      writeFileSync(failureFile(main), `${failure}\n`);
    }
    return failure;
  }
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
const script = main && cliOf(main);
if (!script || !existsSync(script)) process.exit(0);

if (event === "SessionStart") {
  const notes = [];
  if (existsSync(failureFile(main))) {
    notes.push(
      `The last session's sweep failed: ${readFileSync(failureFile(main), "utf8").trim()}`,
    );
  }
  if (!existsSync(join(main, "packages/cli/node_modules"))) notes.push(installFix(main));
  if (notes.length > 0) {
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext:
            "Removed worktrees' dev environments (databases, Redis keys) may still be on the " +
            `verification services. ${notes.join(" ")}`,
        },
      }),
    );
  }
  // Detached and unwaited, so the session starts at once; it records its result for the next one.
  spawn("node", [import.meta.filename, "--record", main], {
    cwd: main,
    detached: true,
    stdio: "ignore",
  }).unref();
  process.exit(0);
}

const failure = sweep({ main, record: event === "SessionEnd" });
if (failure && event === "PostToolUse") {
  // The removal already happened; `block` hands the reason to Claude so it retries the sweep.
  console.log(
    JSON.stringify({
      decision: "block",
      reason:
        "The worktree is removed, but its dev environment couldn't be torn down, so its " +
        `database or Redis keys are still there: ${failure}`,
    }),
  );
} else if (failure) {
  process.stderr.write(`pnpm dev:prune failed: ${failure}\n`);
}
