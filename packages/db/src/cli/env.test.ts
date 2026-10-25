import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadWebEnvFallback } from "./env";

describe("loadWebEnvFallback", () => {
  let root: string;
  const main = () => join(root, "main");
  const worktree = () => join(root, "wt");

  // A repository at <root>/main with a linked worktree at <root>/wt, each with its .env.local.
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "env-test-"));
    mkdirSync(main());
    const git = (...args: string[]) => execFileSync("git", args, { cwd: main(), stdio: "ignore" });
    git("init", "--quiet");
    git(
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "init",
    );
    git("worktree", "add", "--quiet", worktree());
    for (const checkout of [main(), worktree()]) {
      mkdirSync(join(checkout, "apps/web"), { recursive: true });
      writeFileSync(
        join(checkout, "apps/web/.env.local"),
        "DATABASE_URL=postgres://app@localhost:5432/dev\nDATABASE_PASSWORD_FILE=../../.secrets/pw\n",
      );
    }
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("reads .env.local in the main checkout, resolving the password file against apps/web", () => {
    const env: NodeJS.ProcessEnv = {};
    expect(loadWebEnvFallback({ env, root: main() })).toBe("apps/web/.env.local");
    expect(env).toEqual({
      DATABASE_URL: "postgres://app@localhost:5432/dev",
      DATABASE_PASSWORD_FILE: join(main(), ".secrets/pw"),
    });
  });

  it("refuses the shared dev database in a linked worktree", () => {
    const env: NodeJS.ProcessEnv = {};
    expect(() => loadWebEnvFallback({ env, root: worktree() })).toThrow(/git worktree/);
    expect(env).toEqual({});
  });

  it("reads a worktree's own database, the one `pnpm dev` writes into its .env.local", () => {
    writeFileSync(
      join(worktree(), "apps/web/.env.local"),
      "DATABASE_URL=postgres://app@localhost:5433/wt_task_0ebb429f\nDATABASE_PASSWORD_FILE=/repo/.secrets/pw\n",
    );
    const env: NodeJS.ProcessEnv = {};
    expect(loadWebEnvFallback({ env, root: worktree() })).toBe("apps/web/.env.local");
    expect(env).toEqual({
      DATABASE_URL: "postgres://app@localhost:5433/wt_task_0ebb429f",
      DATABASE_PASSWORD_FILE: "/repo/.secrets/pw",
    });
  });

  it.each([
    "postgres://app@localhost:5432/cognitive_wealth",
    "postgres://app@localhost:5433/verify_3100",
    "postgres://app@localhost:5432/wt_task_0ebb429f",
  ])("refuses %s in a worktree's .env.local", (url) => {
    writeFileSync(join(worktree(), "apps/web/.env.local"), `DATABASE_URL=${url}\n`);
    const env: NodeJS.ProcessEnv = {};
    expect(() => loadWebEnvFallback({ env, root: worktree() })).toThrow(/git worktree/);
    expect(env).toEqual({});
  });

  it("leaves an explicit DATABASE_URL alone, in a worktree too", () => {
    const env: NodeJS.ProcessEnv = { DATABASE_URL: "postgres://app@localhost:5499/task" };
    expect(loadWebEnvFallback({ env, root: worktree() })).toBeUndefined();
    expect(env).toEqual({ DATABASE_URL: "postgres://app@localhost:5499/task" });
  });
});
