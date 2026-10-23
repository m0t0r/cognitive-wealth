// Client-safe constants shared by the server config, the route handler and the web app.

/** Where `app/api/auth/[...all]/route.ts` mounts the handler. */
export const AUTH_BASE_PATH = "/api/auth";

export const COOKIE_PREFIX = "cw";

/**
 * The session cookie's name. With secure cookies Better Auth adds the `__Secure-` prefix, so an
 * optimistic "is there a session?" check (`proxy.ts`) should accept either.
 */
export const SESSION_COOKIE_NAMES = [
  `${COOKIE_PREFIX}.session_token`,
  `__Secure-${COOKIE_PREFIX}.session_token`,
] as const;

/** The device cookie's name before Better Auth adds `cw.` (docs/auth.md, "Device cookie"). */
export const DEVICE_COOKIE = "device";

/** The device cookie's full name, without and with secure cookies. */
export const DEVICE_COOKIE_NAMES = [
  `${COOKIE_PREFIX}.${DEVICE_COOKIE}`,
  `__Secure-${COOKIE_PREFIX}.${DEVICE_COOKIE}`,
] as const;

/**
 * What a sign-in link token may look like: the verify route refuses anything else as
 * `invalid_request`, and the confirm page treats anything else as a dead link without calling it.
 */
export const SIGN_IN_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

/**
 * Sign-in emails per address and client IP (docs/auth.md, "Sign-in email limits"). Both windows
 * apply, each fixed from its first request: someone who resends quickly waits at most 10 minutes,
 * and one requester's hourly total stays below the per-address backstop. The sign-in page counts
 * its own requests against the same rules to say when another email can go out.
 */
export const SIGN_IN_REQUESTER_LIMITS = {
  burst: { window: 10 * 60, max: 3 },
  hour: { window: 60 * 60, max: 6 },
} as const;
