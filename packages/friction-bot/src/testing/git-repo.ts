// Real git repositories in a temp directory, for the commit and push tests: a bare `origin` with
// `dev`, and a clone of it on `dev`. Real git rather than a fake, since what's tested is git's own
// behaviour: what a bundle holds, and that a push without --force can't overwrite a branch.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Settings that keep the user's own git config (signing, hooks) out of a test. */
const ISOLATED = ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null"];

export async function git({ cwd, args }: { cwd: string; args: string[] }): Promise<string> {
  const { stdout } = await run("git", [...ISOLATED, ...args], {
    cwd,
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  });
  return stdout.trim();
}

export type TempRepo = {
  /** The parent of `origin` and `clone`. */
  dir: string;
  origin: string;
  /** A clone of `origin` on `dev`. */
  clone: string;
  /** Runs git in `clone` (or `cwd`). */
  git: (args: string[], cwd?: string) => Promise<string>;
  /** Writes `files` in `clone` (or `cwd`) and commits them as one commit; returns its id. */
  commit: (args: {
    files: Record<string, string>;
    message?: string;
    cwd?: string;
  }) => Promise<string>;
  write: (files: Record<string, string>, cwd?: string) => Promise<void>;
  remove: () => Promise<void>;
};

export async function tempRepo(): Promise<TempRepo> {
  const dir = await mkdtemp(join(tmpdir(), "friction-git-"));
  const origin = join(dir, "origin.git");
  const clone = join(dir, "clone");
  await git({ cwd: dir, args: ["init", "-q", "--bare", "-b", "dev", origin] });
  await git({ cwd: dir, args: ["clone", "-q", origin, clone] });
  const inRepo = (args: string[], cwd = clone) =>
    git({ cwd, args: ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args] });
  const write = async (files: Record<string, string>, cwd = clone) => {
    for (const [path, content] of Object.entries(files)) {
      // oxlint-disable-next-line no-await-in-loop -- a handful of files, in order
      await mkdir(dirname(join(cwd, path)), { recursive: true });
      // oxlint-disable-next-line no-await-in-loop -- a handful of files, in order
      await writeFile(join(cwd, path), content);
    }
  };
  const repo: TempRepo = {
    dir,
    origin,
    clone,
    git: inRepo,
    write,
    async commit({ files, message = "change", cwd = clone }) {
      await write(files, cwd);
      await inRepo(["add", "-A"], cwd);
      await inRepo(["commit", "-q", "-m", message], cwd);
      return await inRepo(["rev-parse", "HEAD"], cwd);
    },
    remove: () => rm(dir, { recursive: true, force: true }),
  };
  await repo.commit({ files: { "README.md": "readme\n" }, message: "initial" });
  await inRepo(["push", "-q", "origin", "dev"]);
  return repo;
}
