import { resolve } from "node:path";

/** The checkout `cw` runs from: a worktree's own, in a worktree. */
export const REPO_ROOT = resolve(import.meta.dirname, "../../..");

/**
 * `path` resolved against where the command was typed. pnpm runs a root script from the repo
 * root, and sets INIT_CWD to the directory it was typed in.
 */
export function fromInvocation(path: string): string {
  // pnpm sets it; `cw` isn't a Turborepo task, so turbo.json needn't list it.
  // oxlint-disable-next-line turbo/no-undeclared-env-vars
  return resolve(process.env.INIT_CWD ?? process.cwd(), path);
}
