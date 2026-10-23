#!/usr/bin/env node
// SessionStart and PostToolUse(EnterWorktree) hook: a fresh worktree has the tracked files and
// what .worktreeinclude copies, but no node_modules and no Python virtual environment. Install
// them (about 3 s from the pnpm store, about 1 s from uv's cache) so lint, tests and builds work on
// the first try. Does nothing in the main checkout, and skips each step whose result is already
// there. Output goes to stderr: it's for the transcript, not the model.
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
if (!linked) process.exit(0);

if (!existsSync(join(top, "node_modules"))) {
  try {
    execFileSync("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], {
      cwd: top,
      stdio: ["ignore", 2, 2],
    });
  } catch {
    // Not fatal: the agent sees the missing node_modules and CLAUDE.md says to install.
    console.error(`pnpm install failed in ${top}; run it there before building or testing.`);
  }
}

// The custodian (ADR 0011) is a uv project; `uv run` would sync on first use, but a .venv up front
// gives editors and pyright an interpreter. --frozen installs uv.lock as committed.
const custodian = join(top, "apps/custodian");
if (existsSync(join(custodian, "pyproject.toml")) && !existsSync(join(custodian, ".venv"))) {
  try {
    execFileSync("uv", ["sync", "--frozen"], { cwd: custodian, stdio: ["ignore", 2, 2] });
  } catch {
    console.error(`uv sync failed in ${custodian}; run it there before checking or testing.`);
  }
}
