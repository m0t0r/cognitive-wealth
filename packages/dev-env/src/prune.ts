// The sweep that keeps worktree environments from outliving their worktrees: tears down every one
// whose worktree git no longer lists, however it went (a removal hook, the session exit prompt, a
// subagent's cleanup, `rm -rf`). It finds them from the records and, so a lost record can't hide
// anything, from the databases, Redis keys and running `pnpm dev` processes themselves. Only
// worktrees that are gone are touched, so it's safe to run at any time. Node runs the CLIs that
// import this directly (type stripping), so relative imports keep their `.ts` extension.
import { dirname } from "node:path";
import { liveWorktrees } from "./checkout.ts";
import {
  WORKTREE_REDIS_PATTERN,
  resourcesOfToken,
  tokenOfDatabase,
  tokenOfRedisKey,
  worktreeResources,
} from "./names.ts";
import { readRecords } from "./registry.ts";
import { connectAdmin, connectJanitor, isRefused } from "./services.ts";
import {
  type Server,
  type TeardownTarget,
  runningServers,
  stopServer,
  tearDown,
} from "./teardown.ts";

async function databaseTokens(mainCheckout: string): Promise<string[]> {
  const { client, close } = connectAdmin(mainCheckout);
  try {
    const rows = await client<{ datname: string }[]>`select datname from pg_database`;
    return rows.flatMap(({ datname }) => tokenOfDatabase(datname) ?? []);
  } catch (error) {
    // The verification Postgres keeps its data in memory: if it isn't running, nothing is left.
    if (isRefused(error)) return [];
    throw error;
  } finally {
    await close();
  }
}

async function redisTokens(mainCheckout: string): Promise<string[]> {
  let janitor;
  try {
    janitor = await connectJanitor(mainCheckout);
  } catch (error) {
    if (isRefused(error)) return [];
    throw error;
  }
  try {
    return (await janitor.keys(WORKTREE_REDIS_PATTERN)).flatMap(
      (key) => tokenOfRedisKey(key) ?? [],
    );
  } finally {
    await janitor.close();
  }
}

/** What's left of worktrees that are gone: environments, and servers found only by process. */
export async function findOrphans(mainCheckout: string) {
  const worktrees = liveWorktrees(mainCheckout);
  const live = new Set(worktrees.map(({ id }) => worktreeResources(id).token));

  const targets = new Map<string, TeardownTarget>();
  for (const token of [
    ...(await databaseTokens(mainCheckout)),
    ...(await redisTokens(mainCheckout)),
  ]) {
    targets.set(token, resourcesOfToken(token));
  }
  // A record carries the server too, so it wins over a target found by name.
  for (const record of readRecords(mainCheckout)) targets.set(record.token, record);
  const environments = [...targets.values()].filter(({ token }) => !live.has(token));

  // A `pnpm dev` whose record was lost is found by its working directory (`<checkout>/apps/web`)
  // instead: one that's in no live checkout belongs to a worktree that's gone.
  const checkouts = new Set([mainCheckout, ...worktrees.map(({ path }) => path)]);
  const recorded = new Set(environments.flatMap(({ server }) => (server ? [server.pid] : [])));
  const servers: Array<Server & { cwd: string }> = runningServers().filter(
    ({ pid, cwd }) => !recorded.has(pid) && !checkouts.has(dirname(dirname(cwd))),
  );
  return { environments, servers };
}

/**
 * Tears down every orphan and returns one line per thing removed. Every orphan is tried even when
 * one fails; then it throws with every failure, and a later sweep retries what's left.
 */
export async function prune(mainCheckout: string): Promise<string[]> {
  const { environments, servers } = await findOrphans(mainCheckout);
  const done: string[] = [];
  const failures: string[] = [];
  for (const server of servers) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- one at a time, like the environments below
      done.push(`${server.cwd}: ${await stopServer(server)}`);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  for (const target of environments) {
    try {
      // Sequential, so the output stays in order and one failure doesn't hide another's lines.
      // oxlint-disable-next-line no-await-in-loop
      const lines = await tearDown({ mainCheckout, target });
      done.push(`${target.database}: ${lines.join("; ")}`);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (failures.length > 0) throw new Error(failures.join("\n"));
  return done;
}

/**
 * `prune` as a side errand (`pnpm dev`, `pnpm dev:env`): says what it removed, warns instead of
 * failing, and stays quiet when there was nothing to do.
 */
export async function sweep(mainCheckout: string) {
  try {
    const done = await prune(mainCheckout);
    if (done.length > 0) {
      console.log(`Tore down what was left of removed worktrees:\n  ${done.join("\n  ")}`);
    }
  } catch (error) {
    console.warn(
      `warning: couldn't tear down what's left of removed worktrees (retry: pnpm dev:prune): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
