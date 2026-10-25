// What a worktree's dev environment is called. Node runs the CLIs that import this directly (type
// stripping), so relative imports keep their `.ts` extension.
import { createHash } from "node:crypto";

/**
 * A worktree's database and Redis prefix on the verification services. Both come from the
 * worktree's id (its directory under `.git/worktrees/`), which stays the same when the branch is
 * renamed, so a `git branch -m` can't orphan them.
 */
export type WorktreeResources = {
  /** The id's slug plus a hash of the id, so ids that slug the same (`a-b`, `a_b`) stay apart. */
  token: string;
  database: string;
  /** Under `cw:`, the only keys the Redis ACL lets the app touch. */
  redisPrefix: string;
};

// 3 (`wt_`) + 40 + 1 + 8 bytes stays well under Postgres's 63-byte identifier limit.
const MAX_SLUG = 40;
const TOKEN = "[a-z0-9_]+_[0-9a-f]{8}";
const DATABASE = new RegExp(`^wt_(${TOKEN})$`);
const REDIS_KEY = new RegExp(`^cw:wt:(${TOKEN}):.+$`);

/** The SCAN pattern that matches every worktree's Redis keys. */
export const WORKTREE_REDIS_PATTERN = "cw:wt:*";

export function worktreeResources(id: string): WorktreeResources {
  const slug =
    id
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, MAX_SLUG)
      .replace(/_+$/, "") || "worktree";
  const hash = createHash("sha256").update(id).digest("hex").slice(0, 8);
  const token = `${slug}_${hash}`;
  return { token, database: `wt_${token}`, redisPrefix: `cw:wt:${token}:` };
}

/** The token of a database a worktree's setup created, or undefined for any other database. */
export function tokenOfDatabase(name: string): string | undefined {
  return DATABASE.exec(name)?.[1];
}

/** The token of a key under a worktree's Redis prefix, or undefined for any other key. */
export function tokenOfRedisKey(key: string): string | undefined {
  return REDIS_KEY.exec(key)?.[1];
}
