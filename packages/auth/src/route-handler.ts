// The browser-facing HTTP surface (ADR 0004; docs/auth.md, "Browser-facing HTTP surface"). Only
// four Better Auth endpoints are reachable; their requests are rebuilt from validated parts and
// their responses replaced, so no Better Auth body, header or redirect reaches the browser.
import * as z from "zod";
import type { Auth } from "./auth";
import { sanitizeCallbackPath } from "./callback-path";
import { AUTH_BASE_PATH, SIGN_IN_TOKEN_PATTERN } from "./constants";
import { consumeRateLimit } from "./rate-limit";
import { SIGN_IN_CODE_LIMIT, normalizeEmail } from "./sign-in";

/** The only error codes the browser ever sees. */
export type AuthErrorCode =
  | "invalid_or_expired"
  | "rate_limited"
  | "invalid_request"
  | "forbidden"
  | "unknown";

const ERROR_STATUS: Record<AuthErrorCode, number> = {
  invalid_or_expired: 400,
  rate_limited: 429,
  invalid_request: 400,
  forbidden: 403,
  unknown: 500,
};

const ROUTES = {
  "sign-in": { method: "POST", path: "/sign-in/magic-link" },
  verify: { method: "GET", path: "/magic-link/verify" },
  otp: { method: "POST", path: "/sign-in/email-otp" },
  "sign-out": { method: "POST", path: "/sign-out" },
} as const satisfies Record<string, { method: "GET" | "POST"; path: string }>;

export type AuthRoute = keyof typeof ROUTES;

const AUTH_ROUTES = Object.keys(ROUTES).filter((key): key is AuthRoute =>
  Object.hasOwn(ROUTES, key),
);

/**
 * The allowlisted route for a request, or `null`. Matching is exact and case-sensitive on the
 * raw (still percent-encoded) pathname: `/Sign-Out`, `/sign-out/`, `//sign-out` and
 * `/sign%2Dout` are all unknown, so the router never sees a path we didn't check.
 */
export function matchAuthRoute(method: string, pathname: string): AuthRoute | null {
  return (
    AUTH_ROUTES.find(
      (route) =>
        method === ROUTES[route].method && pathname === `${AUTH_BASE_PATH}${ROUTES[route].path}`,
    ) ?? null
  );
}

/**
 * Whether a GET came from `fetch()` on one of our own pages. Browsers set `Sec-Fetch-*` and
 * pages can't forge them; a link click, scanner, prefetch or `<img>` arrives as `navigate` or
 * `no-cors`, or cross-site, so it can never spend a sign-in token.
 */
export function isSameOriginFetch(headers: Headers): boolean {
  const mode = headers.get("sec-fetch-mode");
  return (
    headers.get("sec-fetch-site") === "same-origin" && (mode === "cors" || mode === "same-origin")
  );
}

/**
 * Whether a POST came from our origin (login CSRF protection, on top of Better Auth's own check,
 * which skips cookie-less requests to `/sign-in/email-otp`). Requires `Origin`. Browsers send
 * `Origin: null` on same-origin POSTs from pages with `Referrer-Policy: no-referrer` (our sign-in
 * pages), which is accepted only alongside `Sec-Fetch-Site: same-origin`.
 */
export function isSameOriginPost(headers: Headers, origin: string): boolean {
  const site = headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return false;
  const requestOrigin = headers.get("origin");
  if (requestOrigin === origin) return true;
  return requestOrigin === "null" && site === "same-origin";
}

/**
 * The status and body the browser sees for Better Auth's response to `route`. `code` is the
 * `code` field of Better Auth's error body, if any.
 */
export function mapAuthResponse(
  route: AuthRoute,
  status: number,
  code: string | undefined,
): { status: number; body: Record<string, unknown> } {
  if (status >= 200 && status < 300) {
    return { status: 200, body: route === "sign-in" ? { status: true } : { ok: true } };
  }
  if (status === 429) return failure("rate_limited");
  if (route === "verify") {
    // Better Auth answers a bad, used or expired token by redirecting to `errorCallbackURL`
    // (`/?error=INVALID_TOKEN` without callback params). Never pass that redirect on.
    if (status >= 300 && status < 400) return failure("invalid_or_expired");
  }
  if (route === "otp") {
    // `TOO_MANY_ATTEMPTS` too: only an address that was sent a code can run out of attempts, so
    // a distinct answer would tell anyone who guesses 4 times which addresses can sign in.
    if (code === "INVALID_OTP" || code === "OTP_EXPIRED" || code === "TOO_MANY_ATTEMPTS") {
      return failure("invalid_or_expired");
    }
  }
  if (status === 403) return failure("forbidden");
  if (status >= 400 && status < 500) return failure("invalid_request");
  return failure("unknown");
}

function failure(error: AuthErrorCode) {
  return { status: ERROR_STATUS[error], body: { ok: false, error } };
}

const MAX_BODY_BYTES = 4096;

const signInBody = z.strictObject({
  email: z.string().max(254),
  callbackURL: z.string().max(2048).optional(),
});
const otpBody = z.strictObject({
  email: z.string().max(254),
  otp: z.string().regex(/^\d{6}$/),
});

type Rebuilt = { search?: URLSearchParams; body?: Record<string, unknown> } | AuthErrorCode;

/**
 * `{ GET, POST }` for `app/api/auth/[...all]/route.ts`. Pass a function to build the auth instance
 * on the first request instead of at import (so `next build` needs no auth environment).
 */
export function createAuthRouteHandler(auth: Auth | (() => Auth)) {
  const resolve = typeof auth === "function" ? auth : () => auth;

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const route = matchAuthRoute(request.method, url.pathname);
    if (route === null) return notFound();

    const instance = resolve();
    const origin = instance.$deps.baseURL;
    const rebuilt = await rebuild(route, request, url, origin);
    if (typeof rebuilt === "string")
      return json(ERROR_STATUS[rebuilt], { ok: false, error: rebuilt });
    if (route === "otp" && !(await withinCodeBudget(instance, rebuilt.body))) {
      // The same answer as a wrong code, for every address: the link in the email still works.
      return json(ERROR_STATUS.invalid_or_expired, { ok: false, error: "invalid_or_expired" });
    }

    // Ask Better Auth with a request built from checked parts only, against our own origin (the
    // incoming host may be an internal address behind the proxy).
    const target = new URL(`${AUTH_BASE_PATH}${ROUTES[route].path}`, origin);
    if (rebuilt.search) target.search = rebuilt.search.toString();
    const headers = forwardHeaders(request.headers);
    let upstream: Response;
    try {
      upstream = await instance.handler(
        new Request(target, {
          method: ROUTES[route].method,
          headers,
          body: rebuilt.body === undefined ? undefined : JSON.stringify(rebuilt.body),
          redirect: "manual",
        }),
      );
    } catch (error) {
      console.error("Auth handler failed", error);
      return json(ERROR_STATUS.unknown, { ok: false, error: "unknown" });
    }

    const code = await errorCode(upstream);
    const mapped = mapAuthResponse(route, upstream.status, code);
    if (mapped.body.error === "unknown") {
      // The browser only sees `unknown`; keep what Better Auth actually answered. Its error codes
      // are fixed identifiers; bodies, tokens and addresses stay out of the log.
      console.error("Auth route got an unexpected answer", {
        route,
        status: upstream.status,
        code: code ?? null,
      });
    }
    const response = json(mapped.status, mapped.body);
    // Keep Better Auth's cookies: the session (set on sign-in, cleared on sign-out) and the device
    // cookie (set on sign-in; `sign-out` leaves it). The incoming `Cookie` header is forwarded
    // as is, so `sendMagicLink` sees the device cookie.
    for (const cookie of upstream.headers.getSetCookie())
      response.headers.append("set-cookie", cookie);
    const retryAfter = upstream.headers.get("x-retry-after");
    if (upstream.status === 429 && retryAfter && /^\d+$/.test(retryAfter)) {
      response.headers.set("retry-after", retryAfter);
    }
    return response;
  }

  return { GET: handle, POST: handle };
}

/**
 * Counts a code attempt against its address's daily budget ({@link SIGN_IN_CODE_LIMIT}). Each code
 * allows 3 tries and an address gets at most 10 codes an hour, so without it someone could keep
 * guessing an address's codes all day; with it, they get a handful. Every address is counted the
 * same way, whether or not it can sign in.
 */
async function withinCodeBudget(auth: Auth, body: Record<string, unknown> | undefined) {
  const email = body?.email;
  if (typeof email !== "string") return false;
  const key = `sign-in-code:${normalizeEmail(email)}`;
  return (await consumeRateLimit(auth.$deps.storage, key, SIGN_IN_CODE_LIMIT)).ok;
}

async function rebuild(
  route: AuthRoute,
  request: Request,
  url: URL,
  origin: string,
): Promise<Rebuilt> {
  if (route === "verify") {
    // Only `token`: callback params would make Better Auth redirect, and an attacker-chosen
    // `errorCallbackURL` is an open redirect waiting to happen.
    const keys = [...url.searchParams.keys()];
    const token = url.searchParams.get("token");
    if (
      keys.length !== 1 ||
      keys[0] !== "token" ||
      token === null ||
      !SIGN_IN_TOKEN_PATTERN.test(token)
    ) {
      return "invalid_request";
    }
    if (!isSameOriginFetch(request.headers)) return "forbidden";
    return { search: new URLSearchParams({ token }) };
  }

  if (url.search !== "") return "invalid_request";
  if (!isSameOriginPost(request.headers, origin)) return "forbidden";
  if (route === "sign-out") return { body: {} };

  const raw = await readJsonBody(request);
  if (raw === undefined) return "invalid_request";
  if (route === "otp") {
    const parsed = otpBody.safeParse(raw);
    return parsed.success ? { body: parsed.data } : "invalid_request";
  }
  const parsed = signInBody.safeParse(raw);
  if (!parsed.success) return "invalid_request";
  const { email, callbackURL } = parsed.data;
  if (callbackURL === undefined) return { body: { email } };
  const callbackPath = sanitizeCallbackPath(callbackURL);
  return callbackPath === null ? "invalid_request" : { body: { email, callbackURL: callbackPath } };
}

/** The JSON body, or `undefined` if it isn't JSON or is larger than {@link MAX_BODY_BYTES}. */
async function readJsonBody(request: Request): Promise<unknown> {
  const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json" || request.body === null) return undefined;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    // Chunks arrive in order; reading stops as soon as the body is too large.
    // oxlint-disable-next-line no-await-in-loop
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      // oxlint-disable-next-line no-await-in-loop
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    return undefined;
  }
}

// Hop-by-hop and framing headers describe the incoming request, not the one we build.
const DROPPED_HEADERS = ["host", "content-length", "transfer-encoding", "connection", "expect"];

function forwardHeaders(incoming: Headers): Headers {
  const headers = new Headers(incoming);
  for (const name of DROPPED_HEADERS) headers.delete(name);
  headers.set("content-type", "application/json");
  return headers;
}

async function errorCode(response: Response): Promise<string | undefined> {
  if (!response.headers.get("content-type")?.includes("application/json")) return undefined;
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "code" in body &&
      typeof body.code === "string"
    ) {
      return body.code;
    }
  } catch {
    // Not JSON after all: no code.
  }
  return undefined;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function notFound(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: { "content-type": "text/plain", "cache-control": "no-store" },
  });
}
