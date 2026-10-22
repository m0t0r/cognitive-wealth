import type { SecondaryStorage } from "./types";

export interface MemoryStorage extends SecondaryStorage {
  get(key: string): Promise<string | null>;
  getAndDelete(key: string): Promise<string | null>;
  increment(key: string, ttl: number): Promise<number>;
  set(key: string, value: string, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  /** Live (unexpired) keys, for tests that inspect what was stored. */
  keys(): string[];
}

interface Entry {
  value: string;
  /** Epoch ms; `null` never expires. */
  expiresAt: number | null;
}

/**
 * An in-process `SecondaryStorage` with the Redis adapter's semantics: TTLs in seconds, expired
 * keys read as missing, `increment` creates a counter at 1 whose TTL is set only on creation, and
 * `getAndDelete` reads and removes in one step. `now` is injectable so tests can move the clock.
 */
export function createMemoryStorage({
  now = Date.now,
}: { now?: () => number } = {}): MemoryStorage {
  const entries = new Map<string, Entry>();

  function live(key: string): Entry | undefined {
    const entry = entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= now()) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  }

  return {
    async get(key) {
      return live(key)?.value ?? null;
    },
    async getAndDelete(key) {
      const entry = live(key);
      entries.delete(key);
      return entry?.value ?? null;
    },
    async increment(key, ttl) {
      assertTtl(ttl);
      const entry = live(key);
      if (entry === undefined) {
        entries.set(key, { value: "1", expiresAt: now() + ttl * 1000 });
        return 1;
      }
      const count = Number.parseInt(entry.value, 10);
      // Redis's INCR refuses a non-integer value too.
      if (!Number.isSafeInteger(count)) throw new Error("Value at key is not an integer");
      entry.value = String(count + 1);
      return count + 1;
    },
    async set(key, value, ttl) {
      if (ttl === undefined) {
        entries.set(key, { value, expiresAt: null });
        return;
      }
      // An already-expired value is the same as no value.
      if (!(ttl > 0)) {
        entries.delete(key);
        return;
      }
      entries.set(key, { value, expiresAt: now() + Math.ceil(ttl) * 1000 });
    },
    async delete(key) {
      entries.delete(key);
    },
    keys() {
      return [...entries.keys()].filter((key) => live(key) !== undefined);
    },
  };
}

export function assertTtl(ttl: number): void {
  if (!Number.isInteger(ttl) || ttl <= 0) throw new RangeError("TTL must be a positive integer");
}
