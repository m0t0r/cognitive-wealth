#!/usr/bin/env node
// SessionStart and PostToolUse(EnterWorktree) hook: a fresh worktree has the tracked files and
// what .worktreeinclude copies, but no node_modules. Install them (about 3 s from the pnpm store)
// so lint, tests and builds work on the first try. Does nothing in the main checkout or in a
// worktree that already has them. Output goes to stderr: it's for the transcript, not the model.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const { cwd } = JSON.parse(readFileSync(0, "utf8"));
const git = (...a) => {
  try {
    return execFileSync("git", ["-C", cwd, ...a], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};

const top = git("rev-parse", "--show-toplevel");
const linked =
  top &&
  git("rev-parse", "--path-format=absolute", "--git-dir") !==
    git("rev-parse", "--path-format=absolute", "--git-common-dir");
if (!linked || existsSync(join(top, "node_modules"))) process.exit(0);

try {
  execFileSync("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], {
    cwd: top,
    stdio: ["ignore", 2, 2],
  });
} catch {
  // Not fatal: the agent sees the missing node_modules and CLAUDE.md says to install.
  console.error(`pnpm install failed in ${top}; run it there before building or testing.`);
}
