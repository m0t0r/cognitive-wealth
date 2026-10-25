// `web`'s `dev:app` (portless runs it): in a linked worktree, sets up the worktree's own database
// and env first, then runs `next dev` and records it so `pnpm dev:teardown` can stop it. In the
// main checkout it only runs `next dev`, on the dev stack as before. Node runs this file directly
// (type stripping), so relative imports keep their `.ts` extension.
import { spawn } from "node:child_process";
import { checkoutAt } from "../checkout.ts";
import { sweep } from "../prune.ts";
import { readRecord, writeRecord } from "../registry.ts";
import { setUpWorktree } from "../setup.ts";

const checkout = checkoutAt(process.cwd());
const { mainCheckout, worktreeId } = checkout;

// Before anything else, clear what removed worktrees left behind, in the main checkout too.
await sweep(mainCheckout);

let token: string | undefined;
if (worktreeId) {
  try {
    const { record, created } = await setUpWorktree({ ...checkout, worktreeId });
    token = record.token;
    console.log(
      `${created ? "Created, migrated and seeded" : "Migrated"} this worktree's database ` +
        `${record.database} (verification Postgres, :5433); Redis keys under ${record.redisPrefix}.`,
    );
  } catch (error) {
    // Never fall back to the dev stack: that's the shared data this setup keeps worktrees off.
    console.error(
      `Couldn't set up this worktree's dev environment: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

// Detached in a worktree, so `next dev` and its workers form a process group teardown can stop
// even if this wrapper is killed first.
const child = spawn("next", ["dev", ...process.argv.slice(2)], {
  stdio: "inherit",
  detached: token !== undefined,
});

function setServer(server: { pid: number; group: number } | undefined) {
  if (!token) return;
  const record = readRecord({ mainCheckout, token });
  if (record) writeRecord({ mainCheckout, record: { ...record, server } });
}

if (child.pid !== undefined) setServer({ pid: process.pid, group: child.pid });

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    // A detached child isn't in the terminal's process group, so Ctrl-C has to be passed on.
    if (token && child.pid !== undefined) {
      try {
        process.kill(-child.pid, signal);
      } catch {
        // Already gone.
      }
    } else {
      child.kill(signal);
    }
  });
}

child.on("error", (error) => {
  console.error(`Couldn't start next dev: ${error.message}`);
  setServer(undefined);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  setServer(undefined);
  process.exit(code ?? (signal ? 1 : 0));
});
