import type { SecondaryStorage } from "./storage/types";

export interface RateLimitRule {
  /** Seconds; the window starts at the first hit and is fixed (never extended). */
  window: number;
  /** Hits allowed per window. */
  max: number;
}

export type RateLimitResult = { ok: true } | { ok: false; retryAfter: number };

/**
 * Counts a hit against `key` and says whether it is within `rule`. For server-side work that
 * Better Auth's limiter can't see: it only runs on HTTP requests through its router, not on
 * `auth.api.*` calls from Server Actions. Keys are namespaced under `rl:` so they can't collide
 * with Better Auth's own entries.
 */
export async function consumeRateLimit(
  storage: Pick<SecondaryStorage, "increment">,
  key: string,
  { window, max }: RateLimitRule,
): Promise<RateLimitResult> {
  const count = await storage.increment(`rl:${key}`, window);
  return count <= max ? { ok: true } : { ok: false, retryAfter: window };
}
