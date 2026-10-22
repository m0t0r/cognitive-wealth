import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export const WEB = join(import.meta.dirname, "../../web");
/** The standalone server that `^build` produces, the same artifact the Docker image runs. */
export const STANDALONE = join(WEB, ".next/standalone/apps/web");

export interface AppServer {
  url: string;
  stop: () => Promise<void>;
}

async function freePort(): Promise<number> {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  server.close();
  await once(server, "close");
  if (!address || typeof address === "string") throw new Error("Could not reserve a port");
  return address.port;
}

async function waitUntilHealthy(url: string, child: ChildProcess, deadline: number): Promise<void> {
  if (child.exitCode !== null) throw new Error(`Server exited with code ${child.exitCode}`);
  if (Date.now() > deadline) throw new Error(`Server at ${url} was not healthy in time`);
  try {
    if ((await fetch(`${url}/api/health`)).ok) return;
  } catch {
    // Not listening yet.
  }
  await sleep(100);
  return waitUntilHealthy(url, child, deadline);
}

/** Starts the standalone server against `databaseUrl` and resolves once its health check passes. */
export async function startServer(databaseUrl: string): Promise<AppServer> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [join(STANDALONE, "server.js")], {
    // Only what the production container gets: no superuser URL or developer credentials.
    env: {
      DATABASE_URL: databaseUrl,
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      PORT: String(port),
    },
    stdio: ["ignore", "ignore", "inherit"],
  });

  const stop = async () => {
    if (child.exitCode !== null) return;
    child.kill();
    await once(child, "exit");
  };

  try {
    await waitUntilHealthy(url, child, Date.now() + 30_000);
  } catch (error) {
    await stop();
    throw error;
  }
  return { url, stop };
}
