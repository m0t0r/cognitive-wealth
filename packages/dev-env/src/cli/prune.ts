// `pnpm dev:prune [--dry-run]`: the safety net behind the teardown hook. Tears down every worktree
// environment whose worktree git no longer lists (deleted by hand, or a teardown that crashed),
// found from the records and, so a lost record can't hide anything, from the databases, Redis keys
// and running `pnpm dev` processes themselves. Node runs this file directly (type stripping), so relative imports keep their
// `.ts` extension.
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { checkoutAt, liveWorktrees } from "../checkout.ts";
import {
  WORKTREE_REDIS_PATTERN,
  resourcesOfToken,
  tokenOfDatabase,
  tokenOfRedisKey,
  worktreeResources,
} from "../names.ts";
import { readRecords } from "../registry.ts";
import { connectAdmin, connectJanitor, isRefused } from "../services.ts";
import { type TeardownTarget, runningServers, stopServer, tearDown } from "../teardown.ts";

async function databaseTokens(mainCheckout: string): Promise<string[]> {
  const { client, close } = connectAdmin(mainCheckout);
  try {
    const rows = await client<{ datname: string }[]>`select datname from pg_database`;
    return rows.flatMap(({ datname }) => tokenOfDatabase(datname) ?? []);
  } catch (error) {
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

async function main() {
  const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
  const { mainCheckout } = checkoutAt(process.cwd());
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
  const orphans = [...targets.values()].filter(({ token }) => !live.has(token));

  // A `pnpm dev` whose record was lost is found by its working directory instead: one that's in
  // no live checkout belongs to a worktree that's gone.
  const checkouts = new Set([mainCheckout, ...worktrees.map(({ path }) => path)]);
  const recorded = new Set(orphans.flatMap(({ server }) => (server ? [server.pid] : [])));
  const strays = runningServers().filter(
    ({ pid, cwd }) => !recorded.has(pid) && !checkouts.has(dirname(dirname(cwd))),
  );

  if (orphans.length === 0 && strays.length === 0) {
    console.log("Nothing to prune: every worktree environment belongs to a live worktree.");
    return;
  }
  if (values["dry-run"]) {
    console.log("Would tear down (their worktrees are gone):");
    for (const { database, redisPrefix, server } of orphans) {
      console.log(
        `  ${database}, Redis keys under ${redisPrefix}${server ? `, pnpm dev pid ${server.pid}` : ""}`,
      );
    }
    for (const { pid, cwd } of strays) console.log(`  pnpm dev pid ${pid} (in ${cwd})`);
    return;
  }
  const failures: string[] = [];
  for (const server of strays) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- one at a time, like the targets below
      console.log(`${server.cwd}: ${await stopServer(server)}`);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  for (const target of orphans) {
    try {
      // Sequential, so the output stays in order and one failure doesn't hide another's lines.
      // oxlint-disable-next-line no-await-in-loop
      const done = await tearDown({ mainCheckout, target });
      console.log(`Tore down ${target.database}:\n${done.map((line) => `  ${line}`).join("\n")}`);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (failures.length > 0) throw new Error(failures.join("\n"));
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
