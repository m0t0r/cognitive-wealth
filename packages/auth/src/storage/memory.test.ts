import { consumeRateLimit } from "../rate-limit";
import { createMemoryStorage } from "./memory";

function clock() {
  let now = 1_000_000;
  return { now: () => now, advance: (ms: number) => void (now += ms) };
}

describe("createMemoryStorage", () => {
  it("expires values after their TTL in seconds", async () => {
    const time = clock();
    const storage = createMemoryStorage(time);
    await storage.set("a", "1", 10);
    await storage.set("b", "2");
    time.advance(9_999);
    expect(await storage.get("a")).toBe("1");
    time.advance(1);
    expect(await storage.get("a")).toBeNull();
    expect(await storage.get("b")).toBe("2");
    expect(storage.keys()).toEqual(["b"]);
  });

  it("treats a non-positive TTL as already expired", async () => {
    const storage = createMemoryStorage();
    await storage.set("a", "1");
    await storage.set("a", "2", 0);
    expect(await storage.get("a")).toBeNull();
  });

  it("reads and deletes in one step", async () => {
    const storage = createMemoryStorage();
    await storage.set("a", "1");
    expect(await storage.getAndDelete("a")).toBe("1");
    expect(await storage.getAndDelete("a")).toBeNull();
  });

  it("deletes", async () => {
    const storage = createMemoryStorage();
    await storage.set("a", "1");
    await storage.delete("a");
    expect(await storage.get("a")).toBeNull();
  });

  it("increments with a fixed window from the first hit", async () => {
    const time = clock();
    const storage = createMemoryStorage(time);
    expect(await storage.increment("n", 60)).toBe(1);
    time.advance(59_000);
    expect(await storage.increment("n", 60)).toBe(2);
    time.advance(1_000);
    expect(await storage.increment("n", 60)).toBe(1);
  });

  it("increments atomically under concurrency", async () => {
    const storage = createMemoryStorage();
    const counts = await Promise.all(Array.from({ length: 50 }, () => storage.increment("n", 60)));
    expect(new Set(counts)).toEqual(new Set(Array.from({ length: 50 }, (_, i) => i + 1)));
  });

  it("refuses to increment a non-integer, like Redis", async () => {
    const storage = createMemoryStorage();
    await storage.set("n", "x");
    await expect(storage.increment("n", 60)).rejects.toThrow(/integer/);
    await expect(storage.increment("m", 0)).rejects.toThrow(RangeError);
  });
});

describe("consumeRateLimit", () => {
  it("allows `max` hits per window, then refuses until it resets", async () => {
    const time = clock();
    const storage = createMemoryStorage(time);
    const rule = { window: 60, max: 2 };
    expect(await consumeRateLimit({ storage, key: "k", rule })).toEqual({ ok: true });
    expect(await consumeRateLimit({ storage, key: "k", rule })).toEqual({ ok: true });
    expect(await consumeRateLimit({ storage, key: "k", rule })).toEqual({
      ok: false,
      retryAfter: 60,
    });
    expect(await consumeRateLimit({ storage, key: "other", rule })).toEqual({ ok: true });
    time.advance(60_000);
    expect(await consumeRateLimit({ storage, key: "k", rule })).toEqual({ ok: true });
  });

  it("namespaces its keys", async () => {
    const storage = createMemoryStorage();
    await consumeRateLimit({ storage, key: "k", rule: { window: 60, max: 1 } });
    expect(storage.keys()).toEqual(["rl:k"]);
  });
});
