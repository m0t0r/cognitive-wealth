#!/usr/bin/env node
// PreToolUse guard: agents change this repo only from a linked git worktree, never the main
// checkout, so parallel sessions can't trample each other's branches and the user's checkout stays
// as they left it. It denies, with the fix in the reason:
//
//   - Edit / Write / NotebookEdit of a file inside the main checkout
//   - Bash in the main checkout that moves branches or the index, or rewrites files in place
//
// Reads (cat, grep, git log, gh), Edit / Write of files outside the repo (scratchpad, memory) and a
// fast-forward of the checked-out branch (`git pull --ff-only`) stay allowed.
// Once a session is in a worktree, Claude Code's own isolation keeps it there. This is a guardrail,
// not a sandbox: a shell redirect still gets through. Start Claude with CLAUDE_MAIN_CHECKOUT=1 for
// work that has to happen in the main checkout (e.g. merging a release).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

if (process.env.CLAUDE_MAIN_CHECKOUT === "1") process.exit(0);

const input = JSON.parse(readFileSync(0, "utf8"));
const { tool_name: tool, tool_input: args = {}, cwd } = input;

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

// The main checkout's root when `dir` is inside it, else null (a linked worktree, or not a repo).
function mainCheckout(dir) {
  while (!existsSync(dir)) dir = dirname(dir);
  const top = git(dir, "rev-parse", "--show-toplevel");
  const gitDir = git(dir, "rev-parse", "--path-format=absolute", "--git-dir");
  const common = git(dir, "rev-parse", "--path-format=absolute", "--git-common-dir");
  return top && gitDir === common ? top : null;
}

// Commands that change what's checked out, committed or staged, or edit files in place. An in-place
// rewrite counts whatever its target: scratch files live in a worktree's `.dev/scratch/` instead.
// GNU sed takes `-i` after the script too, so it counts anywhere up to the next `|`, `;`, `&` or
// newline (so `sed -n 1p f | grep -i x` is still a read).
const MUTATING = [
  /\bgit\s+(commit|add|rm|mv|checkout|switch|restore|reset|merge|rebase|cherry-pick|revert|am|apply|stash|pull|branch\s+-[mMdD])\b/,
  /\b(sed|perl)\s([^|;&\n]*\s)?(-[a-zA-Z]*i|--in-place)/,
  /\bpnpm\s+(add|remove|rm|up|update|dlx\s+shadcn)\b/,
];

// Fast-forwarding the main checkout to origin can't create a commit or a conflict, and it's how
// the main checkout (where these hooks run from) picks up a new dev. Only the whole command counts,
// so `git pull --ff-only && git commit …` is still checked.
const FAST_FORWARD =
  /^\s*git\s+(pull\s+--ff-only(\s+origin(\s+dev)?)?|merge\s+--ff-only\s+origin\/dev)\s*$/;

// A `;` or `|` inside quotes (`sed 's/a;b/c/' -i f`) doesn't end the command, so the patterns also
// run with quoted text blanked out. Either match denies; the raw one still sees `sh -c "sed -i …"`.
const command = args.command ?? "";
const unquoted = command.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, "''");

let main = null;
if (["Edit", "Write", "NotebookEdit"].includes(tool)) {
  const path = args.file_path ?? args.notebook_path;
  if (path) main = mainCheckout(dirname(isAbsolute(path) ? path : resolve(cwd, path)));
} else if (
  tool === "Bash" &&
  !FAST_FORWARD.test(command) &&
  MUTATING.some((re) => re.test(command) || re.test(unquoted))
) {
  main = mainCheckout(cwd);
}
if (!main) process.exit(0);

const where = relative(main, cwd) || ".";
const reason = [
  `This repo's agents work in a git worktree, not the main checkout (${main}, cwd ${where}).`,
  "Call EnterWorktree with a short kebab-case name for the task, then redo this step there;",
  "it branches from origin/dev, copies apps/web/.env.local and runs pnpm install.",
  "See 'Worktrees' in CLAUDE.md. If the user explicitly wants this done in the main checkout,",
  "ask them to restart Claude with CLAUDE_MAIN_CHECKOUT=1.",
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
