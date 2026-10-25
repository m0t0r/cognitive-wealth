import type { Auth } from "./auth";
import { createMemoryStorage } from "./storage/memory";
import {
  createAuthRouteHandler,
  isSameOriginFetch,
  isSameOriginPost,
  mapAuthResponse,
  matchAuthRoute,
} from "./route-handler";

const ORIGIN = "https://app.example";

describe("matchAuthRoute", () => {
  it.for([
    ["POST", "/api/auth/sign-in/magic-link", "sign-in"],
    ["GET", "/api/auth/magic-link/verify", "verify"],
    ["POST", "/api/auth/sign-in/email-otp", "otp"],
    ["POST", "/api/auth/sign-out", "sign-out"],
  ] as const)("matches %s %s", ([method, path, route]) => {
    expect(matchAuthRoute(method, path)).toBe(route);
  });

  it.for([
    ["GET", "/api/auth/sign-in/magic-link"],
    ["POST", "/api/auth/magic-link/verify"],
    ["HEAD", "/api/auth/magic-link/verify"],
    ["OPTIONS", "/api/auth/sign-out"],
    ["post", "/api/auth/sign-out"],
    ["POST", "/api/auth/sign-out/"],
    ["POST", "/api/auth/Sign-Out"],
    ["POST", "/API/auth/sign-out"],
    ["POST", "/api/auth//sign-out"],
    ["POST", "/api/auth/sign%2Dout"],
    ["POST", "/api/auth/sign-in%2Fmagic-link"],
    ["POST", "/api/auth/sign-in/magic-link/"],
    ["POST", "/api/auth/Sign-In/Magic-Link"],
    ["POST", "/api/auth//sign-in/magic-link"],
    ["POST", "/api/auth/./sign-out"],
    ["POST", "/api/auth/x/../sign-out"],
    ["POST", "/sign-out"],
    ["GET", "/api/other/get-session"],
    ["POST", "/api/auth"],
    ["GET", "/api/auth/get-session"],
    ["POST", "/api/auth/email-otp/send-verification-otp"],
    ["POST", "/api/auth/sign-in/email"],
    ["POST", "/api/auth/sign-up/email"],
    ["GET", "/api/auth/ok"],
    ["GET", "/api/auth/organization/list"],
  ] as const)("refuses %s %s", ([method, path]) => {
    expect(matchAuthRoute(method, path)).toBeNull();
  });
});

describe("isSameOriginFetch", () => {
  it("accepts a same-origin fetch", () => {
    expect(
      isSameOriginFetch(new Headers({ "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors" })),
    ).toBe(true);
    expect(
      isSameOriginFetch(
        new Headers({ "sec-fetch-site": "same-origin", "sec-fetch-mode": "same-origin" }),
      ),
    ).toBe(true);
  });

  it.for([
    ["a navigation", { "sec-fetch-site": "same-origin", "sec-fetch-mode": "navigate" }],
    ["a no-cors subresource", { "sec-fetch-site": "same-origin", "sec-fetch-mode": "no-cors" }],
    ["a cross-site fetch", { "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors" }],
    ["a same-site fetch", { "sec-fetch-site": "same-site", "sec-fetch-mode": "cors" }],
    ["a user-typed URL", { "sec-fetch-site": "none", "sec-fetch-mode": "navigate" }],
    ["a missing mode", { "sec-fetch-site": "same-origin" }],
    ["no Sec-Fetch headers", {}],
  ] as const)("refuses %s", ([, init]) => {
    expect(isSameOriginFetch(new Headers({ ...init }))).toBe(false);
  });
});

describe("isSameOriginPost", () => {
  const check = (init: Record<string, string>) => isSameOriginPost(new Headers(init), ORIGIN);

  it("accepts our Origin, with or without Sec-Fetch-Site", () => {
    expect(check({ origin: ORIGIN, "sec-fetch-site": "same-origin" })).toBe(true);
    expect(check({ origin: ORIGIN })).toBe(true);
  });

  it("accepts Origin: null only on a same-origin fetch", () => {
    expect(check({ origin: "null", "sec-fetch-site": "same-origin" })).toBe(true);
    expect(check({ origin: "null" })).toBe(false);
  });

  it.for([
    { origin: "https://evil.example" },
    { origin: "https://app.example.evil.example" },
    { origin: "http://app.example" },
    { origin: ORIGIN, "sec-fetch-site": "cross-site" },
    { origin: ORIGIN, "sec-fetch-site": "same-site" },
    { origin: "null", "sec-fetch-site": "cross-site" },
    { "sec-fetch-site": "same-origin" },
    {},
  ] as Record<string, string>[])("refuses %j", (init) => {
    expect(check(init)).toBe(false);
  });
});

describe("mapAuthResponse", () => {
  it("replaces success bodies", () => {
    expect(mapAuthResponse({ route: "sign-in", status: 200 })).toEqual({
      status: 200,
      body: { status: true },
    });
    for (const route of ["verify", "otp", "sign-out"] as const) {
      expect(mapAuthResponse({ route, status: 200 })).toEqual({ status: 200, body: { ok: true } });
    }
  });

  it("turns verify's error redirect into invalid_or_expired", () => {
    for (const status of [302, 303, 307]) {
      expect(mapAuthResponse({ route: "verify", status })).toEqual({
        status: 400,
        body: { ok: false, error: "invalid_or_expired" },
      });
    }
  });

  it("answers every code error the same way, a used-up code included", () => {
    // Only an address that was sent a code can use one up: a distinct answer would reveal it.
    for (const [status, code] of [
      [400, "INVALID_OTP"],
      [400, "OTP_EXPIRED"],
      [403, "TOO_MANY_ATTEMPTS"],
    ] as const) {
      expect(mapAuthResponse({ route: "otp", status, code })).toEqual({
        status: 400,
        body: { ok: false, error: "invalid_or_expired" },
      });
    }
  });

  it("maps everything else to a fixed code", () => {
    expect(mapAuthResponse({ route: "sign-in", status: 429 })).toEqual({
      status: 429,
      body: { ok: false, error: "rate_limited" },
    });
    expect(
      mapAuthResponse({ route: "sign-in", status: 403, code: "INVALID_ORIGIN" }).body.error,
    ).toBe("forbidden");
    expect(
      mapAuthResponse({ route: "sign-in", status: 400, code: "INVALID_EMAIL" }).body.error,
    ).toBe("invalid_request");
    expect(mapAuthResponse({ route: "otp", status: 500 })).toEqual({
      status: 500,
      body: { ok: false, error: "unknown" },
    });
    expect(mapAuthResponse({ route: "sign-in", status: 302 }).body.error).toBe("unknown");
  });
});

/** A stand-in for Better Auth that answers every request with `response` and records requests. */
function fakeAuth(response: () => Response) {
  const requests: Request[] = [];
  const stub = {
    $deps: { baseURL: ORIGIN, storage: createMemoryStorage() },
    handler: async (request: Request) => {
      requests.push(request);
      return response();
    },
  };
  // A stand-in with only what the handler touches.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const auth = stub as unknown as Auth;
  return { auth, requests, ...createAuthRouteHandler(auth) };
}

const browser = {
  "sec-fetch-site": "same-origin",
  "sec-fetch-mode": "cors",
  origin: ORIGIN,
};

function leakyResponse({
  status,
  body,
  extra = {},
}: {
  status: number;
  body: unknown;
  extra?: Record<string, string>;
}) {
  const headers = new Headers({
    "content-type": "application/json",
    "x-better-auth": "1",
    location: "https://evil.example/?error=INVALID_TOKEN",
    ...extra,
  });
  headers.append("set-cookie", "cw.session_token=abc.sig; Path=/; HttpOnly; SameSite=Lax");
  headers.append("set-cookie", "cw.other=1; Path=/");
  return new Response(JSON.stringify(body), { status, headers });
}

describe("createAuthRouteHandler", () => {
  it("replaces the body and drops every header except Set-Cookie", async () => {
    const { GET } = fakeAuth(() =>
      leakyResponse({
        status: 200,
        body: { token: "secret", user: { id: "1", email: "ada@example.com" } },
      }),
    );
    const response = await GET(
      new Request(`${ORIGIN}/api/auth/magic-link/verify?token=abc`, { headers: browser }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(new Set(response.headers.keys())).toEqual(
      new Set(["cache-control", "content-type", "set-cookie"]),
    );
    expect(response.headers.getSetCookie()).toEqual([
      "cw.session_token=abc.sig; Path=/; HttpOnly; SameSite=Lax",
      "cw.other=1; Path=/",
    ]);
  });

  it("never passes a redirect on", async () => {
    const { GET } = fakeAuth(() => leakyResponse({ status: 302, body: null }));
    const response = await GET(
      new Request(`${ORIGIN}/api/auth/magic-link/verify?token=abc`, { headers: browser }),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.json()).toEqual({ ok: false, error: "invalid_or_expired" });
  });

  it("replaces error messages with codes and keeps only a numeric Retry-After", async () => {
    const { POST } = fakeAuth(() =>
      leakyResponse({
        status: 429,
        body: { message: "Too many requests" },
        extra: { "x-retry-after": "42" },
      }),
    );
    const response = await POST(
      new Request(`${ORIGIN}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: { ...browser, "content-type": "application/json" },
        body: JSON.stringify({ email: "ada@example.com" }),
      }),
    );
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ ok: false, error: "rate_limited" });
    expect(response.headers.get("retry-after")).toBe("42");
    expect(response.headers.get("x-retry-after")).toBeNull();
  });

  it("forwards a request rebuilt from checked parts, against the configured origin", async () => {
    const { POST, requests } = fakeAuth(() =>
      leakyResponse({ status: 200, body: { status: true } }),
    );
    await POST(
      new Request("http://10.0.0.5:3000/api/auth/sign-in/magic-link", {
        method: "POST",
        headers: {
          ...browser,
          "content-type": "application/json; charset=utf-8",
          "x-forwarded-for": "203.0.113.1",
        },
        body: JSON.stringify({ email: "ada@example.com", callbackURL: "/a/../b" }),
      }),
    );
    const [forwarded] = requests;
    expect(forwarded!.url).toBe(`${ORIGIN}/api/auth/sign-in/magic-link`);
    expect(forwarded!.headers.get("x-forwarded-for")).toBe("203.0.113.1");
    expect(forwarded!.headers.get("content-type")).toBe("application/json");
    expect(await forwarded!.json()).toEqual({ email: "ada@example.com", callbackURL: "/b" });
  });

  it("forwards only the token on verify", async () => {
    const { GET, requests } = fakeAuth(() => leakyResponse({ status: 200, body: {} }));
    await GET(new Request(`${ORIGIN}/api/auth/magic-link/verify?token=abc`, { headers: browser }));
    expect(requests[0]!.url).toBe(`${ORIGIN}/api/auth/magic-link/verify?token=abc`);
  });

  it.for([
    [
      "a query string on a POST",
      `${ORIGIN}/api/auth/sign-out?callbackURL=https://evil.example`,
      "POST",
    ],
    [
      "a callback param on verify",
      `${ORIGIN}/api/auth/magic-link/verify?token=abc&callbackURL=/x`,
      "GET",
    ],
    [
      "newUserCallbackURL on verify",
      `${ORIGIN}/api/auth/magic-link/verify?token=abc&newUserCallbackURL=https%3A%2F%2Fevil.example`,
      "GET",
    ],
    [
      "errorCallbackURL on verify",
      `${ORIGIN}/api/auth/magic-link/verify?token=abc&errorCallbackURL=https%3A%2F%2Fevil.example`,
      "GET",
    ],
    ["a repeated token", `${ORIGIN}/api/auth/magic-link/verify?token=a&token=b`, "GET"],
    ["no token on verify", `${ORIGIN}/api/auth/magic-link/verify`, "GET"],
    ["a malformed token", `${ORIGIN}/api/auth/magic-link/verify?token=a%20b`, "GET"],
  ] as const)("refuses %s without calling Better Auth", async ([, url, method]) => {
    const { GET, POST, requests } = fakeAuth(() => leakyResponse({ status: 200, body: {} }));
    const response =
      method === "GET"
        ? await GET(new Request(url, { headers: browser }))
        : await POST(new Request(url, { method: "POST", headers: browser, body: "{}" }));
    expect(response.status).toBe(400);
    expect(requests).toEqual([]);
  });

  it.for([
    ["extra body fields", JSON.stringify({ email: "ada@example.com", name: "Mallory" })],
    ["a non-string email", JSON.stringify({ email: ["ada@example.com"] })],
    ["no email", "{}"],
    ["a body that isn't JSON", "email=ada@example.com"],
    ["a JSON array", JSON.stringify(["ada@example.com"])],
  ] as const)("refuses a sign-in request with %s without calling Better Auth", async ([, body]) => {
    const { POST, requests } = fakeAuth(() => leakyResponse({ status: 200, body: {} }));
    const response = await POST(
      new Request(`${ORIGIN}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: { ...browser, "content-type": "application/json" },
        body,
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "invalid_request" });
    expect(requests).toEqual([]);
  });

  it.for([
    ["a cross-origin Origin", { origin: "https://evil.example" }],
    ["no Origin", { origin: null }],
    ["a cross-site fetch", { "sec-fetch-site": "cross-site" }],
    ["Origin: null from another site", { origin: "null", "sec-fetch-site": "cross-site" }],
  ] as const)("forbids a sign-in request with %s without calling Better Auth", async ([, init]) => {
    const { POST, requests } = fakeAuth(() => leakyResponse({ status: 200, body: {} }));
    const headers = new Headers({ ...browser, "content-type": "application/json" });
    for (const [name, value] of Object.entries(init)) {
      if (value === null) headers.delete(name);
      else headers.set(name, value);
    }
    const response = await POST(
      new Request(`${ORIGIN}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers,
        body: JSON.stringify({ email: "ada@example.com" }),
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: "forbidden" });
    expect(requests).toEqual([]);
  });

  it.for([
    ["no Sec-Fetch headers (a scanner)", {}],
    ["a cross-site fetch", { "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors" }],
    ["a same-site fetch", { "sec-fetch-site": "same-site", "sec-fetch-mode": "cors" }],
    ["a no-cors subresource", { "sec-fetch-site": "same-origin", "sec-fetch-mode": "no-cors" }],
  ] as const)("forbids verify from %s without calling Better Auth", async ([, headers]) => {
    const { GET, requests } = fakeAuth(() => leakyResponse({ status: 200, body: {} }));
    const response = await GET(
      new Request(`${ORIGIN}/api/auth/magic-link/verify?token=abc`, { headers: { ...headers } }),
    );
    expect(response.status).toBe(403);
    expect(requests).toEqual([]);
  });

  it("refuses a form-encoded sign-in request without calling Better Auth", async () => {
    const { POST, requests } = fakeAuth(() => leakyResponse({ status: 200, body: {} }));
    const response = await POST(
      new Request(`${ORIGIN}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: { ...browser, "content-type": "application/x-www-form-urlencoded" },
        body: "email=ada@example.com",
      }),
    );
    expect(response.status).toBe(400);
    expect(requests).toEqual([]);
  });

  it("refuses an oversized body", async () => {
    const { POST, requests } = fakeAuth(() => leakyResponse({ status: 200, body: {} }));
    const response = await POST(
      new Request(`${ORIGIN}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: { ...browser, "content-type": "application/json" },
        body: JSON.stringify({ email: "a@example.com", callbackURL: `/${"a".repeat(5000)}` }),
      }),
    );
    expect(response.status).toBe(400);
    expect(requests).toEqual([]);
  });

  it("answers unknown paths with a bare 404 and builds no auth instance", async () => {
    let built = false;
    const { GET } = createAuthRouteHandler(() => {
      built = true;
      throw new Error("must not build");
    });
    const response = await GET(new Request(`${ORIGIN}/api/auth/get-session`));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not Found");
    expect(new Set(response.headers.keys())).toEqual(new Set(["cache-control", "content-type"]));
    expect(built).toBe(false);
  });

  it("logs the route, status and code when it falls back to `unknown`, and nothing else", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = fakeAuth(() =>
      leakyResponse({
        status: 500,
        body: { code: "FAILED_TO_CREATE_SESSION", message: "db detail", token: "t" },
      }),
    );
    const response = await GET(
      new Request(`${ORIGIN}/api/auth/magic-link/verify?token=s3cr3t`, { headers: browser }),
    );

    expect(await response.json()).toEqual({ ok: false, error: "unknown" });
    expect(log).toHaveBeenCalledExactlyOnceWith("Auth route got an unexpected answer", {
      route: "verify",
      status: 500,
      code: "FAILED_TO_CREATE_SESSION",
    });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/s3cr3t|db detail/);
  });

  it("doesn't log answers it maps on purpose", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const [status, code] of [
      [400, "INVALID_OTP"],
      [429, undefined],
      [403, "INVALID_ORIGIN"],
    ] as const) {
      const { POST } = fakeAuth(() => leakyResponse({ status, body: { code } }));
      // Sequential on purpose: each case checks the log afterwards.
      // oxlint-disable-next-line no-await-in-loop
      await POST(
        new Request(`${ORIGIN}/api/auth/sign-in/email-otp`, {
          method: "POST",
          headers: { ...browser, "content-type": "application/json" },
          body: JSON.stringify({ email: "ada@example.com", otp: "123456" }),
        }),
      );
    }
    expect(log).not.toHaveBeenCalled();
  });

  it("answers 500 `unknown` if Better Auth throws", async () => {
    const { POST } = fakeAuth(() => {
      throw new Error("boom: secret detail");
    });
    const response = await POST(
      new Request(`${ORIGIN}/api/auth/sign-out`, { method: "POST", headers: browser }),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: "unknown" });
  });
});
