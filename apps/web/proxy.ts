import { type NextRequest, NextResponse } from "next/server";
import { contentSecurityPolicy } from "@/lib/security-headers";

/**
 * Sets a fresh nonce-based CSP on every page request. Next reads the nonce back from the request's
 * CSP header and stamps it on its own scripts; the root layout passes `x-nonce` to `next-themes`.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce, { dev: process.env.NODE_ENV === "development" });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // API routes get a static CSP from next.config.ts; static assets need none.
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
