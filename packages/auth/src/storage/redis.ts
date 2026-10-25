import type { SecondaryStorage } from "./types";
import { createClient } from "redis";
import { assertTtl } from "./memory";

/** Every key lives under this namespace: the Redis ACL only grants `cw:*`. */
export const REDIS_KEY_NAMESPACE = "cw:";

/**
 * The node-redis commands the adapter uses, and nothing else: the ACL allows GET, SET (EX/PX/NX),
 * DEL, INCR, EXPIRE and GETDEL (no MULTI, EVAL or SCAN).
 */
export interface RedisCommands {
  get(key: string): Promise<string | null>;
  getDel(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    options?: { expiration?: { type: "EX"; value: number }; condition?: "NX" },
  ): Promise<string | null>;
  del(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number, mode?: "NX"): Promise<number>;
}

export interface RedisStorageOptions {
  /** Prepended to every key. Must start with `cw:`. Default `cw:`. */
  keyPrefix?: string;
}

/** Better Auth's `SecondaryStorage` over Redis; see {@link RedisCommands} for what it sends. */
export function createRedisStorage(
  redis: RedisCommands,
  { keyPrefix = REDIS_KEY_NAMESPACE }: RedisStorageOptions = {},
): SecondaryStorage {
  if (!keyPrefix.startsWith(REDIS_KEY_NAMESPACE)) {
    throw new Error(`Redis key prefix must start with "${REDIS_KEY_NAMESPACE}"`);
  }
  const k = (key: string) => `${keyPrefix}${key}`;

  return {
    get: (key) => redis.get(k(key)),
    getAndDelete: (key) => redis.getDel(k(key)),
    // oxlint-disable-next-line max-params -- Better Auth's `SecondaryStorage.set(key, value, ttl)`
    async set(key, value, ttl) {
      if (ttl === undefined) {
        await redis.set(k(key), value);
        return;
      }
      // An already-expired value is the same as no value (and `EX 0` is an error in Redis).
      if (!(ttl > 0)) {
        await redis.del(k(key));
        return;
      }
      await redis.set(k(key), value, { expiration: { type: "EX", value: Math.ceil(ttl) } });
    },
    async delete(key) {
      await redis.del(k(key));
    },
    async increment(key, ttl) {
      assertTtl(ttl);
      const counter = k(key);
      // No MULTI or EVAL, so three commands, sent together on one connection (node-redis pipelines
      // them) and each safe on its own: SET NX creates the counter at 0 with its TTL, INCR counts,
      // and EXPIRE NX adds the TTL only if the counter has none. That covers the counter expiring
      // between SET and INCR (INCR then recreates it without a TTL), so no counter ever outlives
      // its window, and no command extends an existing TTL.
      const [, count] = await Promise.all([
        redis.set(counter, "0", { expiration: { type: "EX", value: ttl }, condition: "NX" }),
        redis.incr(counter),
        redis.expire(counter, ttl, "NX"),
      ]);
      return count;
    },
  };
}

export interface RedisConnectionOptions {
  /** `redis://` or `rediss://`, optionally with a username (`redis://app@host:6379`). */
  url: string;
  /** Overrides any password in `url`. */
  password?: string | undefined;
}

export type RedisClient = ReturnType<typeof createClient>;

/**
 * A node-redis client (not yet connected). The username and password are passed as explicit
 * options: with only `url` and `password`, node-redis lets the URL's username win and drops the
 * password.
 */
export function createRedisClient({ url, password }: RedisConnectionOptions): RedisClient {
  const parsed = new URL(url);
  const username = parsed.username ? decodeURIComponent(parsed.username) : undefined;
  const urlPassword = parsed.password ? decodeURIComponent(parsed.password) : undefined;
  parsed.username = "";
  parsed.password = "";
  return createClient({
    url: parsed.toString(),
    username,
    password: password ?? urlPassword,
  });
}
