import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { requiredEnv } from "./compose";

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

export interface ServerOptions {
  /** The worker database, as the DML-only `app` role. */
  databaseUrl: string;
  /** This worker's Redis namespace; must start with `cw:` (the ACL's key pattern). */
  redisKeyPrefix: string;
}

/**
 * Starts the standalone server on this worker's database and Redis namespace, with the run's
 * Redis, Mailpit and auth secret, and resolves once its health check passes.
 */
export async function startServer({
  databaseUrl,
  redisKeyPrefix,
}: ServerOptions): Promise<AppServer> {
  const port = await freePort();
  // 127.0.0.1 over plain http still gets Secure cookies: Chromium treats loopback as trustworthy.
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [join(STANDALONE, "server.js")], {
    // Only what the production container gets (compose.yaml's `web`): no superuser URL, Redis
    // janitor or Mailpit API credentials, and no developer environment.
    env: {
      DATABASE_URL: databaseUrl,
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      PORT: String(port),
      BETTER_AUTH_URL: url,
      BETTER_AUTH_SECRET: requiredEnv("PLAYWRIGHT_AUTH_SECRET"),
      REDIS_URL: requiredEnv("PLAYWRIGHT_REDIS_URL"),
      REDIS_PASSWORD_FILE: requiredEnv("PLAYWRIGHT_REDIS_PASSWORD_FILE"),
      REDIS_KEY_PREFIX: redisKeyPrefix,
      SMTP_URL: requiredEnv("PLAYWRIGHT_SMTP_URL"),
      EMAIL_TRANSPORT: "smtp",
      EMAIL_FROM: "Cognitive Wealth <no-reply@cognitive-wealth.localhost>",
      // Each test sends its own x-forwarded-for (the `clientIp` fixture), so per-IP rate limits never
      // collide. Trusting a client-set header is safe only because just the runner reaches 127.0.0.1.
      AUTH_TRUSTED_IP_HEADER: "x-forwarded-for",
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
