// `pnpm dev:prune [--dry-run]`: tears down every worktree environment whose worktree git no longer
// lists (`../prune.ts`). The `teardown-worktree` hook runs it after a worktree removal and at the
// start and end of every session, and `pnpm dev` runs it on start; by hand it's for a check
// (`--dry-run`) or a retry. Node runs this file directly (type stripping), so relative imports
// keep their `.ts` extension.
import { parseArgs } from "node:util";
import { checkoutAt } from "../checkout.ts";
import { findOrphans, prune } from "../prune.ts";

async function main() {
  const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
  const { mainCheckout } = checkoutAt(process.cwd());
  if (values["dry-run"]) {
    const { environments, servers } = await findOrphans(mainCheckout);
    if (environments.length === 0 && servers.length === 0) {
      console.log("Nothing to prune: every worktree environment belongs to a live worktree.");
      return;
    }
    console.log("Would tear down (their worktrees are gone):");
    for (const { database, redisPrefix, server } of environments) {
      const pid = server ? `, pnpm dev pid ${server.pid}` : "";
      console.log(
        `  ${database}, Redis keys under ${redisPrefix}${pid}, and its verifier-web servers, ` +
          "databases, --ref checkouts and Chrome",
      );
    }
    for (const { pid, cwd } of servers) console.log(`  pnpm dev pid ${pid} (in ${cwd})`);
    return;
  }
  const done = await prune(mainCheckout);
  console.log(
    done.length === 0
      ? "Nothing to prune: every worktree environment belongs to a live worktree."
      : `Tore down what was left of removed worktrees:\n${done.map((line) => `  ${line}`).join("\n")}`,
  );
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
