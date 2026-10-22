import { createMailpit, parseSignInEmail } from "./mailpit.ts";

/** A cookie in Playwright's shape (`BrowserContext.addCookies`, `storageState`). */
export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Unix time in seconds; -1 for a session cookie. */
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

/** Loadable by Playwright (`storageState`) and `agent-browser --state`. */
export interface StorageState {
  cookies: Cookie[];
  origins: [];
}

export interface SignInResult {
  cookies: Cookie[];
  storageState: StorageState;
}

export interface RequestSignInEmailOptions {
  /** The app's origin, e.g. `http://127.0.0.1:3000`. */
  appUrl: string;
  email: string;
  /** Sent as `x-forwarded-for`, for an app that trusts it (AUTH_TRUSTED_IP_HEADER). */
  ip?: string;
  /** Where the confirm page sends the user afterwards; a relative path. */
  callbackPath?: string;
}

export interface SignInOptions {
  appUrl: string;
  email: string;
  mailpitUrl: string;
  ip?: string;
  /** Only accept an email Mailpit received at or after this time. */
  after?: Date;
  /** How long to wait for the email. Default 10s. */
  timeoutMs?: number;
}

/** A non-success response from the app, with what it said. */
export class SignInError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(step: string, status: number, body: string) {
    super(`${step} failed with ${status}: ${body}`);
    this.name = "SignInError";
    this.status = status;
    this.body = body;
  }
}

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * The headers Chromium sends on a same-origin `fetch()` from one of the app's pages. The verify
 * endpoint refuses anything else, so a scanner or prefetch opening the link can't spend a token.
 */
function browserFetchHeaders(ip: string | undefined): Record<string, string> {
  return {
    accept: "application/json",
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
    ...(ip === undefined ? {} : { "x-forwarded-for": ip }),
  };
}

async function expectJson(step: string, response: Response, accept: (body: unknown) => boolean) {
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  if (!response.ok || !accept(body)) throw new SignInError(step, response.status, text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Step 1 of sign-in: ask the app to email a link and code, as the sign-in form does. */
export async function requestSignInEmail({
  appUrl,
  email,
  ip,
  callbackPath,
}: RequestSignInEmailOptions): Promise<void> {
  const origin = new URL(appUrl).origin;
  const response = await fetch(new URL("/api/auth/sign-in/magic-link", origin), {
    method: "POST",
    headers: {
      ...browserFetchHeaders(ip),
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify(
      callbackPath === undefined ? { email } : { email, callbackURL: callbackPath },
    ),
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  await expectJson(
    "POST /api/auth/sign-in/magic-link",
    response,
    (body) => isRecord(body) && body.status === true,
  );
}

/**
 * Signs `email` in through the app's public HTTP surface only (no backdoor): request the email,
 * read the token from Mailpit, then verify it the way the confirm page's `fetch` does.
 */
export async function signIn({
  appUrl,
  email,
  mailpitUrl,
  ip,
  after,
  timeoutMs,
}: SignInOptions): Promise<SignInResult> {
  const mailpit = createMailpit(mailpitUrl);
  // Mail already in the inbox can't be the one we're about to request.
  const exclude = await mailpit.messageIds(email);
  await requestSignInEmail({ appUrl, email, ip });
  const message = await mailpit.waitForMessage({ to: email, after, exclude, timeoutMs });
  const { token } = parseSignInEmail(message.text);

  const verifyUrl = new URL("/api/auth/magic-link/verify", appUrl);
  verifyUrl.searchParams.set("token", token);
  const response = await fetch(verifyUrl, {
    headers: browserFetchHeaders(ip),
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  await expectJson(
    "GET /api/auth/magic-link/verify",
    response,
    (body) => isRecord(body) && body.ok === true,
  );

  const cookies = parseSetCookies(response.headers.getSetCookie(), verifyUrl);
  if (cookies.length === 0) {
    throw new SignInError("GET /api/auth/magic-link/verify", response.status, "no cookies set");
  }
  return { cookies, storageState: { cookies, origins: [] } };
}

/** RFC 6265 default-path: the request path up to, not including, its last `/`. */
function defaultPath(url: URL): string {
  const path = url.pathname;
  if (!path.startsWith("/") || path.lastIndexOf("/") === 0) return "/";
  return path.slice(0, path.lastIndexOf("/"));
}

const SAME_SITE = { strict: "Strict", lax: "Lax", none: "None" } as const;

function isSameSite(value: string): value is keyof typeof SAME_SITE {
  return Object.hasOwn(SAME_SITE, value);
}

/**
 * Parses `Set-Cookie` headers from a response to `requestUrl` into Playwright cookies. Cookies
 * the response deletes (`Max-Age<=0` or an `Expires` in the past) are left out.
 */
export function parseSetCookies(headers: string[], requestUrl: URL, now = Date.now()): Cookie[] {
  const cookies: Cookie[] = [];
  for (const header of headers) {
    const [pair = "", ...attributes] = header.split(";");
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;

    const cookie: Cookie = {
      name: pair.slice(0, separator).trim(),
      value: pair.slice(separator + 1).trim(),
      domain: requestUrl.hostname,
      path: defaultPath(requestUrl),
      expires: -1,
      httpOnly: false,
      secure: false,
      // What Chromium assumes when the attribute is missing.
      sameSite: "Lax",
    };
    let maxAge: number | undefined;
    let expiresAt: number | undefined;

    for (const attribute of attributes) {
      const [rawKey = "", ...rest] = attribute.split("=");
      const key = rawKey.trim().toLowerCase();
      const value = rest.join("=").trim();
      const lowerValue = value.toLowerCase();
      if (key === "domain" && value) cookie.domain = `.${lowerValue.replace(/^\./, "")}`;
      else if (key === "path" && value.startsWith("/")) cookie.path = value;
      else if (key === "max-age" && /^-?\d+$/.test(value)) maxAge = Number(value);
      else if (key === "expires" && !Number.isNaN(Date.parse(value))) expiresAt = Date.parse(value);
      else if (key === "httponly") cookie.httpOnly = true;
      else if (key === "secure") cookie.secure = true;
      else if (key === "samesite" && isSameSite(lowerValue))
        cookie.sameSite = SAME_SITE[lowerValue];
    }

    // Max-Age wins over Expires (RFC 6265 §5.3).
    if (maxAge !== undefined) {
      if (maxAge <= 0) continue;
      cookie.expires = Math.floor(now / 1000) + maxAge;
    } else if (expiresAt !== undefined) {
      if (expiresAt <= now) continue;
      cookie.expires = Math.floor(expiresAt / 1000);
    }
    cookies.push(cookie);
  }
  return cookies;
}
