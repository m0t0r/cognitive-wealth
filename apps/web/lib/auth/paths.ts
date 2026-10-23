// Client-safe route rules shared by `proxy.ts`, layouts and pages.

export const SIGN_IN_PATH = "/sign-in";

/**
 * Pages anyone may open. Each one that needs a session (`/welcome`, `/no-workspace`, an
 * invitation) checks it itself; everything else is the app and needs a session cookie.
 */
const PUBLIC_PREFIXES = ["/sign-in", "/invite", "/design-system", "/welcome", "/no-workspace"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** `/sign-in`, with `next` when there's somewhere other than `/` to come back to. */
export function signInPath(next?: string | null): string {
  if (!next || next === "/") return SIGN_IN_PATH;
  return `${SIGN_IN_PATH}?${new URLSearchParams({ next }).toString()}`;
}

/** Request header `proxy.ts` sets to the page's path and query, for server-side redirects. */
export const REQUEST_PATH_HEADER = "x-request-path";
