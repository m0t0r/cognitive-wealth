import type { IncomingHttpHeaders } from "node:http";
import { listen, readBody, startFakeMailpit } from "./fake-mailpit";
import { SignInError, parseSetCookies, requestSignInEmail, signIn } from "./sign-in";

const SESSION_COOKIES = [
  "cw.session_token=signed.value%3D; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax",
  "cw.session_data=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax",
];

interface Recorded {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}

/**
 * A fake app speaking the browser-facing surface (docs/auth.md): the sign-in request emails a link
 * and code to the fake Mailpit (after a delay, so the harness has to poll), and verify accepts only
 * the newest token, with the headers a browser `fetch` sends.
 */
async function startFakes(options: { signInStatus?: number } = {}) {
  const mailpit = await startFakeMailpit();
  onTestFinished(mailpit.close);
  const requests: Recorded[] = [];
  let issued = 0;
  let validToken = "";

  const app = await listen(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://app");
    requests.push({
      method: request.method ?? "",
      path: url.pathname,
      headers: request.headers,
      body: await readBody(request),
    });
    response.setHeader("content-type", "application/json");

    if (request.method === "POST" && url.pathname === "/api/auth/sign-in/magic-link") {
      if (options.signInStatus !== undefined) {
        response.statusCode = options.signInStatus;
        response.end(JSON.stringify({ error: "rate_limited" }));
        return;
      }
      const body: unknown = JSON.parse(requests.at(-1)?.body ?? "{}");
      const email = typeof body === "object" && body && "email" in body ? String(body.email) : "";
      issued += 1;
      validToken = `token-${issued}`;
      const token = validToken;
      setTimeout(() => {
        mailpit.deliver({
          to: email,
          subject: "Sign in to Cognitive Wealth",
          text: `Sign-in link: ${app.url}/sign-in/confirm#token=${token}&next=%2F\r\nSign-in code: 123456\r\n`,
        });
      }, 150);
      response.end(JSON.stringify({ status: true }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/auth/magic-link/verify") {
      const sameOrigin =
        request.headers["sec-fetch-site"] === "same-origin" &&
        request.headers["sec-fetch-mode"] !== "navigate";
      if (!sameOrigin || url.searchParams.get("token") !== validToken) {
        response.statusCode = 400;
        response.end(JSON.stringify({ ok: false, error: "invalid_or_expired" }));
        return;
      }
      validToken = "";
      response.setHeader("set-cookie", SESSION_COOKIES);
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    response.statusCode = 404;
    response.end("{}");
  });
  onTestFinished(app.close);

  return { app, mailpit, requests };
}

describe("signIn", () => {
  it("runs request, email and verify like a browser, and returns a storage state", async () => {
    const { app, mailpit, requests } = await startFakes();
    // An earlier sign-in email for the same address must not be the one used.
    mailpit.deliver({
      to: "ann@example.test",
      subject: "Sign in to Cognitive Wealth",
      text: `Sign-in link: ${app.url}/sign-in/confirm#token=stale&next=%2F\nSign-in code: 000000`,
    });
    const before = Math.floor(Date.now() / 1000);

    const result = await signIn({
      appUrl: app.url,
      email: "ann@example.test",
      mailpitUrl: mailpit.url,
      ip: "10.1.2.3",
    });

    const [request, verify] = requests;
    expect(requests).toHaveLength(2);
    expect(request).toMatchObject({
      method: "POST",
      path: "/api/auth/sign-in/magic-link",
      headers: {
        origin: app.url,
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
        "x-forwarded-for": "10.1.2.3",
      },
    });
    expect(JSON.parse(request?.body ?? "")).toEqual({ email: "ann@example.test" });
    expect(verify).toMatchObject({
      method: "GET",
      path: "/api/auth/magic-link/verify",
      headers: {
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
        "x-forwarded-for": "10.1.2.3",
      },
    });

    // The cleared cookie (Max-Age=0) is left out.
    expect(result.cookies).toEqual([
      {
        name: "cw.session_token",
        value: "signed.value%3D",
        domain: "127.0.0.1",
        path: "/",
        expires: expect.any(Number),
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);
    const expires = result.cookies[0]?.expires ?? 0;
    expect(expires - before).toBeGreaterThanOrEqual(604_800);
    expect(expires - before).toBeLessThan(604_800 + 60);
    expect(result.storageState).toEqual({ cookies: result.cookies, origins: [] });
  });

  it("sends no x-forwarded-for without an ip", async () => {
    const { app, mailpit, requests } = await startFakes();

    await signIn({ appUrl: app.url, email: "bo@example.test", mailpitUrl: mailpit.url });

    expect(requests.map((request) => request.headers["x-forwarded-for"])).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("throws a SignInError with the status and body when the app refuses", async () => {
    const { app, mailpit } = await startFakes({ signInStatus: 429 });

    const error = await signIn({
      appUrl: app.url,
      email: "cy@example.test",
      mailpitUrl: mailpit.url,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SignInError);
    expect(error).toMatchObject({ status: 429, body: '{"error":"rate_limited"}' });
  });
});

describe("requestSignInEmail", () => {
  it("passes a callback path as callbackURL", async () => {
    const { app, requests } = await startFakes();

    await requestSignInEmail({
      appUrl: `${app.url}/some/page`,
      email: "dee@example.test",
      callbackPath: "/invite/abc",
    });

    expect(requests[0]?.headers.origin).toBe(app.url);
    expect(JSON.parse(requests[0]?.body ?? "")).toEqual({
      email: "dee@example.test",
      callbackURL: "/invite/abc",
    });
  });
});

describe("parseSetCookies", () => {
  const now = Date.parse("2026-10-22T12:00:00Z");
  const url = new URL("https://app.localhost/api/auth/magic-link/verify?token=x");

  it("maps Domain, Path, Expires and SameSite", () => {
    expect(
      parseSetCookies({
        headers: [
          "a=1; Domain=.App.localhost; Path=/app; Expires=Thu, 29 Oct 2026 12:00:00 GMT; SameSite=strict",
          "b=x=y",
        ],
        requestUrl: url,
        now,
      }),
    ).toEqual([
      {
        name: "a",
        value: "1",
        domain: ".app.localhost",
        path: "/app",
        expires: Date.parse("2026-10-29T12:00:00Z") / 1000,
        httpOnly: false,
        secure: false,
        sameSite: "Strict",
      },
      {
        name: "b",
        value: "x=y",
        domain: "app.localhost",
        // RFC 6265 default-path of the request.
        path: "/api/auth/magic-link",
        expires: -1,
        httpOnly: false,
        secure: false,
        sameSite: "Lax",
      },
    ]);
  });

  it("prefers Max-Age over Expires and drops deleted cookies", () => {
    const cookies = parseSetCookies({
      headers: [
        "keep=1; Max-Age=60; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
        "gone=; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
        "zero=; Max-Age=0",
      ],
      requestUrl: url,
      now,
    });
    expect(cookies.map(({ name, expires }) => ({ name, expires }))).toEqual([
      { name: "keep", expires: now / 1000 + 60 },
    ]);
  });
});
