import "server-only";
import { createAuth, type Auth } from "@repo/auth";
import { authOptionsFromEnv, mailerFromEnv } from "@repo/auth/env";
import { nextCookies } from "@repo/auth/next";
import { createRedisClient, createRedisStorage, type RedisClient } from "@repo/auth/redis";
import { getDb } from "@repo/db/client";
import { after } from "next/server";

const globalForAuth = globalThis as typeof globalThis & { authRedis?: RedisClient };

let auth: Auth | undefined;

/**
 * The app's Better Auth instance, built on first use from the environment (so `next build` needs
 * no auth settings). The Redis client connects once and survives dev hot reloads.
 */
export function getAuth(): Auth {
  if (auth) return auth;
  const options = authOptionsFromEnv(process.env);
  const redis = (globalForAuth.authRedis ??= connectRedis(options.redis));
  auth = createAuth({
    db: getDb(),
    mailer: mailerFromEnv(process.env),
    secondaryStorage: createRedisStorage(redis, { keyPrefix: options.redis.keyPrefix }),
    baseURL: options.baseURL,
    secret: options.secret,
    trustedIpHeader: options.trustedIpHeader,
    trustedProxies: options.trustedProxies,
    secureCookies: options.secureCookies,
    // Sign-in work that runs after the response (so its timing can't reveal who is a client).
    // `after` keeps it alive on every host Next supports: `next start` and Docker drain pending
    // callbacks on SIGTERM, and serverless platforms supply `waitUntil` to it.
    runInBackground: (task) => {
      after(() =>
        task().catch((error: unknown) => console.error("Background auth task failed", error)),
      );
    },
    // Lets Server Actions that call `auth.api` set cookies. Must stay last.
    plugins: [nextCookies()],
  });
  return auth;
}

function connectRedis(options: { url: string; password: string | undefined }): RedisClient {
  const client = createRedisClient(options);
  // Without a listener, a dropped connection would crash the process; node-redis reconnects.
  client.on("error", (error: unknown) => console.error("Redis error", error));
  // Commands sent while connecting are queued, so callers don't wait for this.
  client.connect().catch((error: unknown) => console.error("Redis connection failed", error));
  return client;
}
