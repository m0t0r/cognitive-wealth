import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

// Next compiles the matcher with path-to-regexp; its custom group behaves like this plain regex.
// That mirrors Next internals on purpose: recheck it (and expect breakage) on a Next upgrade.
const [source = ""] = config.matcher;
const matches = (path: string) => new RegExp(`^${source}$`).test(path);

describe("proxy matcher", () => {
  it.each(["/", "/settings", "/api-docs", "/apiary", "/favicon.ico.html"])(
    "sets a CSP on page %s",
    (path) => expect(matches(path)).toBe(true),
  );

  it.each(["/api", "/api/health", "/_next/static/chunks/a.js", "/_next/image", "/favicon.ico"])(
    "skips %s",
    (path) => expect(matches(path)).toBe(false),
  );
});

function request(path: string, cookie?: string) {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie === undefined ? {} : { cookie },
  });
}

describe("proxy session redirect", () => {
  it.each(["/", "/settings/members", "/settings", "/sign-inx", "/invitex/abc"])(
    "sends %s to sign-in without a session cookie",
    (path) => {
      const response = proxy(request(path));
      expect(response.status).toBe(307);
      const location = new URL(response.headers.get("location") ?? "");
      expect(location.pathname).toBe("/sign-in");
      expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    },
  );

  it("keeps the path and query in next, without Next's _rsc parameter", () => {
    const response = proxy(request("/settings/members?tab=pending&_rsc=1a2b"));
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.searchParams.get("next")).toBe("/settings/members?tab=pending");
  });

  it("leaves next out for the home page", () => {
    const response = proxy(request("/"));
    expect(response.headers.get("location")).toBe("http://localhost:3000/sign-in");
  });

  it.each([
    "/sign-in",
    "/sign-in/confirm",
    "/invite/0192f0c4-0000-7000-8000-000000000000",
    "/design-system",
    "/welcome",
    "/no-workspace",
  ])("lets %s through without a session cookie", (path) => {
    const response = proxy(request(path));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("content-security-policy")).toContain("'nonce-");
  });

  it.each(["cw.session_token=abc", "__Secure-cw.session_token=abc"])(
    "lets app pages through with %s",
    (cookie) => {
      const response = proxy(request("/settings/members", cookie));
      expect(response.headers.get("location")).toBeNull();
    },
  );

  it("ignores other cookies", () => {
    const response = proxy(request("/", "cw.session_data=abc; sidebar_state=true"));
    expect(response.status).toBe(307);
  });

  it("passes the nonce and request path to the page", () => {
    const response = proxy(request("/settings/members?tab=pending", "cw.session_token=abc"));
    // NextResponse.next encodes overridden request headers as `x-middleware-request-*`.
    expect(response.headers.get("x-middleware-request-x-request-path")).toBe(
      "/settings/members?tab=pending",
    );
    expect(response.headers.get("x-middleware-request-x-nonce")).toBeTruthy();
  });
});
