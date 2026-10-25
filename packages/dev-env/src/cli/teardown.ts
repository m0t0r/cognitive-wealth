// `pnpm dev:teardown [--worktree <path>]`: stops a worktree's `pnpm dev` and removes its database
// and Redis keys, and stops and removes what its verifier-web runs left, to start a worktree over
// (the next `pnpm dev` sets it up again). Without --worktree it tears down the worktree it runs in.
// A removed worktree's environment goes with `pnpm dev:prune`, which the hooks run. Node runs this
// file directly (type stripping), so relative imports keep their `.ts` extension.
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { checkoutAt, worktreeIdAt } from "../checkout.ts";
import { worktreeResources } from "../names.ts";
import { readRecord, readRecords } from "../registry.ts";
import { type TeardownTarget, runningServerOf, tearDown } from "../teardown.ts";

const USAGE = "Usage: pnpm dev:teardown [--worktree <path>]";

function targetFor({ mainCheckout, path }: { mainCheckout: string; path: string }) {
  const id = worktreeIdAt(path);
  const target: TeardownTarget | undefined = id
    ? (readRecord({ mainCheckout, token: worktreeResources(id).token }) ?? worktreeResources(id))
    : // The worktree may already be gone from disk: its record still says where it was.
      readRecords(mainCheckout).find((record) => record.path === path);
  // A server running without a record (lost, or never written) is found in the process table.
  if (target && !target.server) return { ...target, server: runningServerOf(path) };
  return target;
}

async function main() {
  const { values } = parseArgs({
    options: { worktree: { type: "string" }, help: { type: "boolean", short: "h" } },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  const here = checkoutAt(process.cwd());
  const path = values.worktree ? resolve(values.worktree) : here.top;
  if (path === here.mainCheckout) {
    throw new Error(
      `${path} is the main checkout, whose dev stack this never touches. ` +
        `Run it inside a worktree, or pass --worktree <path>. ${USAGE}`,
    );
  }
  const target = targetFor({ mainCheckout: here.mainCheckout, path });
  if (!target) {
    console.log(`${path} is no worktree and has no record: nothing to tear down.`);
    return;
  }
  const done = await tearDown({ mainCheckout: here.mainCheckout, target });
  console.log(`Tore down ${path}:\n${done.map((line) => `  ${line}`).join("\n")}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
