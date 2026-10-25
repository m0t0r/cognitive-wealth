// `pnpm dev:teardown [--worktree <path>]`: stops a worktree's `pnpm dev` and removes its database
// and Redis keys. Without --worktree it tears down the worktree it runs in. The teardown hook runs
// it from the main checkout before a worktree is removed. Node runs this file directly (type
// stripping), so relative imports keep their `.ts` extension.
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { checkoutAt, worktreeIdAt } from "../checkout.ts";
import { worktreeResources } from "../names.ts";
import { readRecord, readRecords } from "../registry.ts";
import type { TeardownTarget } from "../teardown.ts";
import { tearDown } from "../teardown.ts";

const USAGE = "Usage: pnpm dev:teardown [--worktree <path>]";

function targetFor({ mainCheckout, path }: { mainCheckout: string; path: string }) {
  const id = worktreeIdAt(path);
  if (id) {
    const resources = worktreeResources(id);
    return readRecord({ mainCheckout, token: resources.token }) ?? resources;
  }
  // The worktree may already be gone from disk: its record still says where it was.
  return readRecords(mainCheckout).find((record) => record.path === path);
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
  const target: TeardownTarget | undefined = targetFor({ mainCheckout: here.mainCheckout, path });
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
