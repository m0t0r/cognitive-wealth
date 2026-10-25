// Runs a command with one Postgres for it and everything it starts: the root
// `pnpm test:integration` runs `turbo run test:integration` under it, so every package's global
// setup migrates its template on this one server instead of starting its own (`../postgres.ts`).
// Node runs this file directly (type stripping), so relative imports keep their `.ts` extension.
//
//   node packages/testing/src/cli/with-postgres.ts <command> [args...]
//
// The server stops once the command exits, however it exits; if this process is killed outright,
// Testcontainers' reaper removes it. Exits with the command's exit code.
import { spawn } from "node:child_process";
import { constants } from "node:os";
import { SHARED_POSTGRES_ENV, startPostgresServer } from "../postgres-server.ts";

const [command, ...args] = process.argv.slice(2);
if (command === undefined) {
  console.error("Usage: with-postgres.ts <command> [args...]");
  process.exit(2);
}

const { server, stop } = await startPostgresServer();

const child = spawn(command, args, {
  stdio: "inherit",
  env: { ...process.env, [SHARED_POSTGRES_ENV]: JSON.stringify(server) },
});

// Ctrl-C reaches the command too (same process group); wait for it to finish its own cleanup
// (dropping test databases) before the server goes. A `kill` aimed at this process alone is
// passed on.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => child.kill(signal));
}

const code = await new Promise<number>((resolve) => {
  child.on("error", (error) => {
    console.error(error);
    resolve(1);
  });
  child.on("exit", (exitCode, signal) =>
    resolve(exitCode ?? 128 + (signal ? constants.signals[signal] : 0)),
  );
});

await stop();
process.exit(code);
