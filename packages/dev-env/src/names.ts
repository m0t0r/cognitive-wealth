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
  return resourcesOfToken(`${slug}_${hash}`);
}

/** The names for `token`, e.g. one read back from a database or key whose worktree is gone. */
export function resourcesOfToken(token: string): WorktreeResources {
  return { token, database: `wt_${token}`, redisPrefix: `cw:wt:${token}:` };
}

/**
 * What the verifier-web skill's runs from one checkout use: a port pair (the working tree and a
 * `--ref` build), a database per server and an agent-browser session. Keyed on the worktree's
 * token, so runs from different worktrees never touch each other's.
 */
export type VerifyResources = {
  token: string;
  ports: { head: number; ref: number };
  databases: { head: string; ref: string };
  session: string;
  /**
   * `compose.sh`'s own Compose project, for changes only `compose.yaml`'s images exercise, and the
   * host ports its services publish: offset from `ports.head`, so two checkouts never share them.
   */
  compose: { project: string; ports: { web: number; custodian: number; mailpit: number } };
};

/** Port pairs from 3100 up; the first is the main checkout's. Pair n is 3100 + 2n and the next. */
const VERIFY_BASE_PORT = 3100;
const VERIFY_PAIRS = 400;

/** The verification databases of `token`, e.g. one read back from a leftover of a gone worktree. */
export function verifyDatabasesOf(token: string): VerifyResources["databases"] {
  return { head: `verify_${token}_head`, ref: `verify_${token}_ref` };
}

/** A worktree's agent-browser session, so two worktrees' cookies never share a tab. */
export const verifySessionOf = (token: string) => `verify-${token}`;

/** A checkout's own Compose project, never `cognitive-wealth` (dev) or `cognitive-wealth-verify`. */
export const composeProjectOf = (token: string) => `cw-compose-${token}`;

/** The main checkout's token: it has no hash, so it never matches a worktree's (`TOKEN`). */
const MAIN_TOKEN = "main";

/** The names for the worktree `id`, or for the main checkout when `id` is undefined. */
export function verifyResources(id: string | undefined): VerifyResources {
  const token = id === undefined ? MAIN_TOKEN : worktreeResources(id).token;
  // The token's hash picks one of the pairs after the main checkout's: with at most a few
  // worktrees at a time, two rarely share one, and a run refuses rather than share.
  const pair =
    id === undefined ? 0 : 1 + (Number.parseInt(token.slice(-8), 16) % (VERIFY_PAIRS - 1));
  const head = VERIFY_BASE_PORT + 2 * pair;
  return {
    token,
    ports: { head, ref: head + 1 },
    databases: verifyDatabasesOf(token),
    session: id === undefined ? "verify" : verifySessionOf(token),
    compose: {
      project: composeProjectOf(token),
      ports: { web: head + 1000, custodian: head + 2000, mailpit: head + 3000 },
    },
  };
}

/** The token of a database a worktree's setup created, or undefined for any other database. */
export function tokenOfDatabase(name: string): string | undefined {
  return DATABASE.exec(name)?.[1];
}

const VERIFY_DATABASE = new RegExp(`^verify_(${TOKEN})_(?:head|ref)$`);
const REF_CHECKOUT = new RegExp(`^(${TOKEN})-[0-9a-f]+$`);
const COMPOSE_PROJECT = new RegExp(`^cw-compose-(${TOKEN})$`);

/** The token of a worktree's own Compose project, or undefined for any other, the main checkout's included. */
export function tokenOfComposeProject(name: string): string | undefined {
  return COMPOSE_PROJECT.exec(name)?.[1];
}

/**
 * The token of a worktree's verification database, or undefined for any other database, the main
 * checkout's included: prune must never take that one for an orphan.
 */
export function tokenOfVerifyDatabase(name: string): string | undefined {
  return VERIFY_DATABASE.exec(name)?.[1];
}

/** The token of a worktree's `--ref` checkout (`<token>-<sha>`), from its directory name. */
export function tokenOfRefCheckout(name: string): string | undefined {
  return REF_CHECKOUT.exec(name)?.[1];
}

/** The token of a key under a worktree's Redis prefix, or undefined for any other key. */
export function tokenOfRedisKey(key: string): string | undefined {
  return REDIS_KEY.exec(key)?.[1];
}

const STATE_DIR = new RegExp(`^(${TOKEN})$`);

type OrphanTokensArgs = {
  /** The tokens of the worktrees git still lists. */
  live: Set<string>;
  databases: string[];
  redisKeys: string[];
  /** The directories under the main checkout's `.dev/verify/`. */
  stateDirs: string[];
  /** The directories under the main checkout's `.dev/worktrees/`. */
  refCheckouts: string[];
  /** Every Compose project's name (`docker compose ls --all`). */
  composeProjects: string[];
};

/**
 * The tokens of worktrees that are gone but left something behind, each once. Anything not named
 * after a worktree's token, the main checkout's verification state included, is never one.
 */
export function orphanTokens({
  live,
  databases,
  redisKeys,
  stateDirs,
  refCheckouts,
  composeProjects,
}: OrphanTokensArgs): string[] {
  const found = new Set([
    ...databases.flatMap((name) => tokenOfDatabase(name) ?? tokenOfVerifyDatabase(name) ?? []),
    ...redisKeys.flatMap((key) => tokenOfRedisKey(key) ?? []),
    ...stateDirs.flatMap((name) => STATE_DIR.exec(name)?.[1] ?? []),
    ...refCheckouts.flatMap((name) => tokenOfRefCheckout(name) ?? []),
    ...composeProjects.flatMap((name) => tokenOfComposeProject(name) ?? []),
  ]);
  return [...found.difference(live)];
}
