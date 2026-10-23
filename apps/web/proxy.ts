import { SESSION_COOKIE_NAMES } from "@repo/auth/constants";
import { type NextRequest, NextResponse } from "next/server";
import { isPublicPath, REQUEST_PATH_HEADER, signInPath } from "@/lib/auth/paths";
import { contentSecurityPolicy } from "@/lib/security-headers";

/**
 * Sets a fresh nonce-based CSP on every page request. Next reads the nonce back from the request's
 * CSP header and stamps it on its own scripts; the root layout passes `x-nonce` to `next-themes`.
 *
 * App pages without a session cookie are sent to `/sign-in?next=…` early. That check is
 * optimistic (the cookie may be stale); layouts, pages and Server Actions verify the session.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce, { dev: process.env.NODE_ENV === "development" });
  const path = requestPath(request);

  if (!isPublicPath(request.nextUrl.pathname) && !hasSessionCookie(request)) {
    const response = NextResponse.redirect(new URL(signInPath(path), request.url));
    response.headers.set("Content-Security-Policy", csp);
    return response;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  requestHeaders.set(REQUEST_PATH_HEADER, path);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export function hasSessionCookie(request: Pick<NextRequest, "cookies">): boolean {
  return SESSION_COOKIE_NAMES.some((name) => request.cookies.has(name));
}

/** The page's path and query, without Next's internal RSC cache-busting parameter. */
export function requestPath(request: Pick<NextRequest, "nextUrl">): string {
  const search = new URLSearchParams(request.nextUrl.search);
  search.delete("_rsc");
  const query = search.toString();
  return query ? `${request.nextUrl.pathname}?${query}` : request.nextUrl.pathname;
}

export const config = {
  // API routes get a static CSP from next.config.ts; static assets need none. Segment-anchored so
  // a page like `/api-docs` still gets a CSP. Prefetches run it too, so `x-nonce` is always ours.
  matcher: ["/((?!api(?:/|$)|_next/static/|_next/image(?:/|$)|favicon\\.ico$).*)"],
};
