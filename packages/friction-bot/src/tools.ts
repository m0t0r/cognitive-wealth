// The fixer's tools: read, list and search the checkout, write, edit and delete files outside the
// paths only the user changes, and run the repo's own checks. Nothing here reaches the network or
// git's history, and the checks run without the workflow's credentials.
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { tool, type ToolSet } from "ai";
import { z } from "zod";

const run = promisify(execFile);

/**
 * What only the user changes (CLAUDE.md, "Worktrees"). The skills' scripts are among them: they
 * run on the user's machine, where no check here reaches. `commitFix` and `pushFix` check it again.
 */
export const FORBIDDEN =
  // Any case: the user's Mac checks `.Claude/Hooks/` out into `.claude/hooks/`.
  /^(\.claude\/hooks\/|\.claude\/settings[^/]*\.json$|\.claude\/skills\/|\.github\/|\.git\/)/i;

/** The paths a `git diff --name-only` prints, unquoted (`-z`), so an odd name can't hide a prefix. */
export async function changedPaths({ root, args }: { root: string; args: string[] }) {
  const { stdout } = await run("git", ["diff", "--name-only", "--no-renames", "-z", ...args], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.split("\0").filter(Boolean);
}

/** The refusal for a fix that changes `paths`, which only the user changes. */
export function forbiddenMessage(paths: string[]): string {
  return `The fix changes paths only the user changes: ${paths.join(", ")}.`;
}

export const CHECKS = [
  "lint",
  "format",
  "format:check",
  "check-types",
  "test",
  "test:integration",
] as const;

const MAX_OUTPUT = 30_000;
const CHECK_TIMEOUT_MS = 20 * 60_000;
/**
 * Kept out of the checks' environment: a script the agent edited runs there. That alone doesn't
 * hide what this process started with (`/proc/<pid>/environ`), so the workflow hands the API key
 * over as a file instead, and its GitHub token is a read-only one. Neither stops a check set on
 * reading this process's memory with the runner's sudo (`api-key.ts`).
 */
const SECRETS = new Set([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_API_KEY_FILE",
  "GH_TOKEN",
  "GITHUB_TOKEN",
]);

/** `path` relative to `root`, with `/` separators; an error when it leaves `root`. */
export function repoPath({ root, path }: { root: string; path: string }): string {
  const inside = relative(root, resolve(root, path));
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) {
    throw new Error(`${path} is outside the repository.`);
  }
  return inside.split(sep).join("/");
}

export function writablePath({ root, path }: { root: string; path: string }): string {
  const inside = repoPath({ root, path });
  if (FORBIDDEN.test(inside)) throw new Error(`${inside} is changed only by the user.`);
  return inside;
}

/** `text` with `oldString` replaced once; an error unless it occurs exactly once. */
export function replaceOnce({
  text,
  oldString,
  newString,
}: {
  text: string;
  oldString: string;
  newString: string;
}): string {
  const first = text.indexOf(oldString);
  if (oldString === "" || first === -1) throw new Error("old_string isn't in the file.");
  if (text.indexOf(oldString, first + 1) !== -1) {
    throw new Error("old_string occurs more than once; include more of the surrounding text.");
  }
  return text.slice(0, first) + newString + text.slice(first + oldString.length);
}

/** The end of long output, where a failing check says what failed. */
export function tail(text: string): string {
  return text.length > MAX_OUTPUT
    ? `… (${text.length - MAX_OUTPUT} characters cut)\n${text.slice(-MAX_OUTPUT)}`
    : text;
}

function head(text: string): string {
  return text.length > MAX_OUTPUT
    ? `${text.slice(0, MAX_OUTPUT)}\n… (${text.length - MAX_OUTPUT} characters cut)`
    : text;
}

const asText = (value: unknown) => (typeof value === "string" ? value : "");

/** What a failed `execFile` leaves on its error: the exit code and the output so far. */
function execFailure(error: unknown): { code: number | string | undefined; output: string } {
  if (typeof error !== "object" || error === null)
    return { code: undefined, output: String(error) };
  const field = (name: string): unknown => (name in error ? Reflect.get(error, name) : undefined);
  const code = field("code");
  return {
    code: typeof code === "number" || typeof code === "string" ? code : undefined,
    output: asText(field("stdout")) + asText(field("stderr")),
  };
}

async function git({ root, args }: { root: string; args: string[] }): Promise<string> {
  try {
    const { stdout } = await run("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    // `git grep` exits 1 when nothing matches.
    if (execFailure(error).code === 1) return "";
    throw error;
  }
}

export type Check = (typeof CHECKS)[number];
export type CheckResult = { exitCode: number | string; output: string };

/** `pnpm <check>` in `root`, without the secrets: its exit code and the end of its output. */
export async function runCheck({
  root,
  check,
}: {
  root: string;
  check: Check;
}): Promise<CheckResult> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !SECRETS.has(name)),
  );
  try {
    const { stdout, stderr } = await run("pnpm", [check], {
      cwd: root,
      env,
      timeout: CHECK_TIMEOUT_MS,
      maxBuffer: 256 * 1024 * 1024,
    });
    return { exitCode: 0, output: tail(stdout + stderr) };
  } catch (error) {
    // A non-zero exit, or the timeout (code undefined, the process killed).
    const { code, output } = execFailure(error);
    return { exitCode: code ?? "killed", output: tail(output) };
  }
}

export function fixTools(root: string): ToolSet {
  return {
    read_file: tool({
      description: "Read a file in the repository (paths are relative to its root).",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) =>
        head(await readFile(resolve(root, repoPath({ root, path })), "utf8")),
    }),
    list_files: tool({
      description:
        "List the repository's tracked files matching a glob, e.g. `docs/**/*.md` or `packages/db/**`.",
      inputSchema: z.object({ pattern: z.string() }),
      execute: async ({ pattern }) =>
        head(await git({ root, args: ["ls-files", "--", `:(glob)${pattern}`] })) ||
        "No files match.",
    }),
    search: tool({
      description:
        "Search tracked files for an extended regular expression, optionally under one path. Prints file:line:text.",
      inputSchema: z.object({ pattern: z.string(), path: z.string().optional() }),
      execute: async ({ pattern, path }) => {
        const paths = path ? [repoPath({ root, path })] : [];
        return (
          head(
            await git({ root, args: ["grep", "-n", "-I", "-E", "-e", pattern, "--", ...paths] }),
          ) || "No matches."
        );
      },
    }),
    write_file: tool({
      description:
        "Create or replace a whole file. Prefer edit_file for a change to an existing file.",
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      execute: async ({ path, content }) => {
        const target = resolve(root, writablePath({ root, path }));
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content);
        return `Wrote ${path}.`;
      },
    }),
    edit_file: tool({
      description: "Replace one exact, unique piece of text in a file with another.",
      inputSchema: z.object({ path: z.string(), old_string: z.string(), new_string: z.string() }),
      execute: async ({ path, old_string: oldString, new_string: newString }) => {
        const target = resolve(root, writablePath({ root, path }));
        const text = await readFile(target, "utf8");
        await writeFile(target, replaceOnce({ text, oldString, newString }));
        return `Edited ${path}.`;
      },
    }),
    delete_file: tool({
      description:
        "Delete a file, such as a scratch file you made. A new file is committed only when a fixed report's summary names its path.",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        await rm(resolve(root, writablePath({ root, path })));
        return `Deleted ${path}.`;
      },
    }),
    run_check: tool({
      description:
        "Run one of the repository's checks from its root (`pnpm <check>`) and get its exit code and the end of its output. `format` rewrites files to the repo's formatting.",
      inputSchema: z.object({ check: z.enum(CHECKS) }),
      execute: async ({ check }) => await runCheck({ root, check }),
    }),
  };
}
