// Test wiring: Better Auth over a test's PGlite database with a memory mailer and storage. Only
// for tests (it imports dev dependencies).
import type { Database } from "@repo/db";
import { member, organization, user } from "@repo/db/schema";
import type { EmailMessage } from "@repo/email";
import { createMemoryMailer } from "@repo/email/testing";
import { parseSetCookies } from "@repo/testing/sign-in";
import { parseSignInEmail } from "@repo/testing/mailpit";
import { setTimeout as sleep } from "node:timers/promises";
import type { Role } from "./access";
import { createAuth, type AuthDeps } from "./auth";
import type { BackgroundRunner } from "./sign-in";
import { AUTH_BASE_PATH } from "./constants";
import { createAuthRouteHandler } from "./route-handler";
import { createMemoryStorage } from "./storage/memory";

export { createMemoryStorage, type MemoryStorage } from "./storage/memory";

export const TEST_BASE_URL = "http://localhost:3000";
export const TEST_SECRET = "test-secret-that-is-at-least-32-characters-long";
export const TEST_IP_HEADER = "x-forwarded-for";

/**
 * Keys anywhere in `value` that look like internal IDs: `id`, or ending in `Id`, except
 * `publicId` and `…PublicId`. DTOs and responses must have none.
 */
export function internalIdKeys(value: unknown): string[] {
  const found: string[] = [];
  const visit = (node: unknown) => {
    if (node instanceof Date || typeof node !== "object" || node === null) return;
    for (const [key, child] of Object.entries(node)) {
      if ((key === "id" || key.endsWith("Id")) && key !== "publicId" && !key.endsWith("PublicId")) {
        found.push(key);
      }
      visit(child);
    }
  };
  visit(value);
  return found;
}

export interface TestRequestInit {
  method?: "GET" | "POST";
  body?: unknown;
  /** Sent as `x-forwarded-for`. Default: a fresh address per request, so per-IP limits don't trip. */
  ip?: string;
  /** Replace or remove (`null`) any of the browser-like default headers. */
  headers?: Record<string, string | null>;
}

/**
 * A background runner that starts each task at once and remembers it until it settles, so tests
 * can wait for all of them (`settle`) instead of sleeping.
 */
export function createTrackingRunner() {
  const pending = new Set<Promise<void>>();
  const runInBackground: BackgroundRunner = (task) => {
    const run: Promise<void> = Promise.resolve()
      .then(task)
      .catch((error: unknown) => {
        console.error("Background task failed", error);
      })
      .finally(() => pending.delete(run));
    pending.add(run);
  };
  /** Resolves once every task, including ones started by other tasks, has settled. */
  async function settle(): Promise<void> {
    while (pending.size > 0) {
      // oxlint-disable-next-line no-await-in-loop
      await Promise.all(pending);
    }
  }
  return { runInBackground, settle };
}

/**
 * Better Auth on `orm` with a memory mailer and memory storage, a fixed base URL and secret,
 * `x-forwarded-for` as the trusted IP header, and a tracking background runner (`settle`). Build
 * one per test.
 */
export function createTestAuth({ orm, ...overrides }: { orm: Database } & Partial<AuthDeps>) {
  const mailer = createMemoryMailer();
  const storage = createMemoryStorage();
  const runner = createTrackingRunner();
  const settle = runner.settle;
  const auth = createAuth({
    db: orm,
    mailer,
    secondaryStorage: storage,
    baseURL: TEST_BASE_URL,
    secret: TEST_SECRET,
    trustedIpHeader: TEST_IP_HEADER,
    runInBackground: runner.runInBackground,
    ...overrides,
  });
  const handler = createAuthRouteHandler(auth);

  let ipCounter = 0;
  const freshIp = () => {
    ipCounter += 1;
    return `198.51.100.${ipCounter % 250}`;
  };

  /** A `Request` to `/api/auth<path>` with the headers a same-origin `fetch()` sends. */
  function request(path: string, init: TestRequestInit = {}): Request {
    const method = init.method ?? (init.body === undefined ? "GET" : "POST");
    const headers = new Headers({
      accept: "application/json",
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
      "sec-fetch-dest": "empty",
      "user-agent": "vitest",
      [TEST_IP_HEADER]: init.ip ?? freshIp(),
      ...(method === "POST" ? { origin: TEST_BASE_URL, "content-type": "application/json" } : {}),
    });
    for (const [name, value] of Object.entries(init.headers ?? {})) {
      if (value === null) headers.delete(name);
      else headers.set(name, value);
    }
    return new Request(`${TEST_BASE_URL}${AUTH_BASE_PATH}${path}`, {
      method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  }

  /** Sends a request through the route handler, as the browser would. */
  function fetchAuth(path: string, init: TestRequestInit = {}): Promise<Response> {
    const req = request(path, init);
    return req.method === "GET" ? handler.GET(req) : handler.POST(req);
  }

  /** The next email to `to` after the first `after` messages, once background sends finish. */
  async function waitForEmail({
    to,
    after = 0,
    timeoutMs = 5000,
  }: {
    to: string;
    after?: number;
    timeoutMs?: number;
  }): Promise<EmailMessage> {
    await settle();
    // Still polls, for a test that passes a runner of its own.
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const message = mailer.messages.slice(after).find((m) => m.to === to);
      if (message) return message;
      if (Date.now() > deadline) throw new Error(`No email to ${to} within ${timeoutMs}ms`);
      // oxlint-disable-next-line no-await-in-loop
      await sleep(5);
    }
  }

  /** Requests a sign-in email for `email` and returns its link token and code. */
  async function requestSignIn(email: string, init: Omit<TestRequestInit, "body"> = {}) {
    const before = mailer.messages.length;
    const response = await fetchAuth("/sign-in/magic-link", { ...init, body: { email } });
    if (response.status !== 200) throw new Error(`sign-in request failed: ${response.status}`);
    const message = await waitForEmail({ to: email.trim().toLowerCase(), after: before });
    return parseSignInEmail(message.text);
  }

  /** `Headers` that carry the session cookies of `response`, for `auth.api` and the tenant API. */
  function sessionHeaders(response: Response): Headers {
    const cookies = parseSetCookies({
      headers: response.headers.getSetCookie(),
      requestUrl: new URL(TEST_BASE_URL),
    });
    if (cookies.length === 0) throw new Error("Response set no cookies");
    return new Headers({
      cookie: cookies.map(({ name, value }) => `${name}=${value}`).join("; "),
      origin: TEST_BASE_URL,
      "user-agent": "vitest",
    });
  }

  /** Signs `email` in through the real flow (request, email, verify) and returns its headers. */
  async function signInAs(email: string): Promise<Headers> {
    const { token } = await requestSignIn(email);
    const response = await fetchAuth(`/magic-link/verify?token=${encodeURIComponent(token)}`);
    if (response.status !== 200) throw new Error(`verify failed: ${response.status}`);
    return sessionHeaders(response);
  }

  async function seedUser({ email, name = "" }: { email: string; name?: string }) {
    const [row] = await orm
      .insert(user)
      .values({ email: email.toLowerCase(), name, emailVerified: true })
      .returning();
    return row!;
  }

  async function seedOrganization({
    name,
    slug,
    members = [],
  }: {
    name: string;
    slug: string;
    members?: { userId: number; role: Role; createdAt?: Date }[];
  }) {
    const [org] = await orm.insert(organization).values({ name, slug }).returning();
    const rows = [];
    for (const m of members) {
      // One at a time, so `members` comes back in the order given.
      // oxlint-disable-next-line no-await-in-loop
      const [row] = await orm
        .insert(member)
        .values({ organizationId: org!.id, userId: m.userId, role: m.role, createdAt: m.createdAt })
        .returning();
      rows.push(row!);
    }
    return { ...org!, members: rows };
  }

  return {
    auth,
    mailer,
    storage,
    handler,
    request,
    fetchAuth,
    waitForEmail,
    settle,
    requestSignIn,
    sessionHeaders,
    signInAs,
    seedUser,
    seedOrganization,
  };
}

export type TestAuth = ReturnType<typeof createTestAuth>;
