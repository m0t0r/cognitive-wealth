import { createRedisClient, createRedisStorage, type RedisCommands } from "./redis";

/**
 * A small in-memory Redis speaking the command subset the adapter may use. Every command advances
 * the clock by `tick` ms, so tests can make a key expire between two commands.
 */
function createFakeRedis({ tick = 0 } = {}) {
  let now = 1_000_000;
  const data = new Map<string, { value: string; expiresAt: number | null }>();
  const log: string[] = [];

  function live(key: string) {
    const entry = data.get(key);
    if (entry && entry.expiresAt !== null && entry.expiresAt <= now) data.delete(key);
    return data.get(key);
  }
  function step(command: string) {
    now += tick;
    log.push(command);
  }

  const redis: RedisCommands = {
    async get(key) {
      step(`GET ${key}`);
      return live(key)?.value ?? null;
    },
    async getDel(key) {
      step(`GETDEL ${key}`);
      const value = live(key)?.value ?? null;
      data.delete(key);
      return value;
    },
    // oxlint-disable-next-line max-params -- `RedisCommands` mirrors node-redis's `set(key, value, options)`
    async set(key, value, options) {
      const ex = options?.expiration?.value;
      step(
        `SET ${key} ${value}${ex === undefined ? "" : ` EX ${ex}`}${options?.condition ? ` ${options.condition}` : ""}`,
      );
      if (options?.condition === "NX" && live(key)) return null;
      data.set(key, { value, expiresAt: ex === undefined ? null : now + ex * 1000 });
      return "OK";
    },
    async del(key) {
      step(`DEL ${key}`);
      return data.delete(key) ? 1 : 0;
    },
    async incr(key) {
      step(`INCR ${key}`);
      const entry = live(key);
      const next = Number(entry?.value ?? "0") + 1;
      data.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? null });
      return next;
    },
    // oxlint-disable-next-line max-params -- `RedisCommands` mirrors node-redis's `expire(key, seconds, mode)`
    async expire(key, seconds, mode) {
      step(`EXPIRE ${key} ${seconds}${mode ? ` ${mode}` : ""}`);
      const entry = live(key);
      if (!entry || (mode === "NX" && entry.expiresAt !== null)) return 0;
      entry.expiresAt = now + seconds * 1000;
      return 1;
    },
  };
  return {
    redis,
    log,
    ttl: (key: string) => {
      const entry = live(key);
      return entry === undefined
        ? -2
        : entry.expiresAt === null
          ? -1
          : (entry.expiresAt - now) / 1000;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("createRedisStorage", () => {
  it("prefixes every key", async () => {
    const fake = createFakeRedis();
    const storage = createRedisStorage(fake.redis, { keyPrefix: "cw:test:" });
    await storage.set("a", "1");
    await storage.get("a");
    await storage.getAndDelete("a");
    await storage.delete("a");
    await storage.increment("n", 10);
    expect(fake.log.every((command) => command.split(" ")[1]!.startsWith("cw:test:"))).toBe(true);
  });

  it("defaults the prefix to cw: and refuses one outside it", () => {
    const fake = createFakeRedis();
    expect(() => createRedisStorage(fake.redis, { keyPrefix: "app:" })).toThrow(/cw:/);
    expect(() => createRedisStorage(fake.redis)).not.toThrow();
  });

  it("sets with a TTL in seconds, or without one", async () => {
    const fake = createFakeRedis();
    const storage = createRedisStorage(fake.redis);
    await storage.set("a", "1", 60);
    await storage.set("b", "2");
    expect(await storage.get("a")).toBe("1");
    expect(await storage.get("b")).toBe("2");
    expect(fake.ttl("cw:a")).toBe(60);
    expect(fake.ttl("cw:b")).toBe(-1);
  });

  it("deletes instead of setting an already-expired value", async () => {
    const fake = createFakeRedis();
    const storage = createRedisStorage(fake.redis);
    await storage.set("a", "1");
    await storage.set("a", "2", 0);
    expect(await storage.get("a")).toBeNull();
    expect(fake.ttl("cw:a")).toBe(-2);
  });

  it("reads and deletes atomically with GETDEL", async () => {
    const fake = createFakeRedis();
    const storage = createRedisStorage(fake.redis);
    await storage.set("a", "1", 60);
    expect(await storage.getAndDelete("a")).toBe("1");
    expect(await storage.get("a")).toBeNull();
    // One command, not GET then DEL: the fake can't race two clients, so the command is the proof.
    expect(fake.log).toContain("GETDEL cw:a");
  });

  it("increments a counter whose TTL starts at the first hit and never extends", async () => {
    const fake = createFakeRedis();
    const storage = createRedisStorage(fake.redis);
    expect(await storage.increment("n", 60)).toBe(1);
    fake.advance(30_000);
    expect(await storage.increment("n", 60)).toBe(2);
    expect(fake.ttl("cw:n")).toBe(30);
    fake.advance(30_000);
    expect(await storage.increment("n", 60)).toBe(1);
    expect(fake.ttl("cw:n")).toBe(60);
  });

  it("never leaves a counter without a TTL, even if it expires between SET and INCR", async () => {
    // The counter has 1ms left; each command takes 1ms, so SET NX sees it and INCR doesn't.
    const fake = createFakeRedis({ tick: 1 });
    const storage = createRedisStorage(fake.redis);
    await fake.redis.set("cw:n", "5", { expiration: { type: "EX", value: 0.002 } });

    expect(await storage.increment("n", 60)).toBe(1);
    expect(fake.ttl("cw:n")).toBeGreaterThan(59);
  });

  it("only uses commands the ACL allows", async () => {
    const fake = createFakeRedis();
    const storage = createRedisStorage(fake.redis);
    await storage.set("a", "1", 1);
    await storage.get("a");
    await storage.getAndDelete("a");
    await storage.delete("a");
    await storage.increment("n", 1);
    const commands = new Set(fake.log.map((command) => command.split(" ")[0]));
    expect(
      [...commands].every((c) => ["GET", "SET", "DEL", "INCR", "EXPIRE", "GETDEL"].includes(c!)),
    ).toBe(true);
  });

  it("refuses a non-positive or fractional increment TTL", async () => {
    const storage = createRedisStorage(createFakeRedis().redis);
    await expect(storage.increment("n", 0)).rejects.toThrow(RangeError);
    await expect(storage.increment("n", 1.5)).rejects.toThrow(RangeError);
  });
});

describe("createRedisClient", () => {
  it("passes the URL's username and the separate password explicitly", () => {
    const client = createRedisClient({
      url: "redis://app@redis.internal:6379/0",
      password: "hunter2",
    });
    expect(client.options).toMatchObject({ username: "app", password: "hunter2" });
    expect(client.options.url).not.toContain("app@");
  });

  it("falls back to a password in the URL", () => {
    const client = createRedisClient({ url: "redis://app:s%40cret@redis:6379" });
    expect(client.options).toMatchObject({ username: "app", password: "s@cret" });
  });
});
