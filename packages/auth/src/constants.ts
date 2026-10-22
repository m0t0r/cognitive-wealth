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
