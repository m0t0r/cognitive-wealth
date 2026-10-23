// Next internal, on purpose: a Next upgrade that moves or changes it should break this test.
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { describe, expect, it } from "vitest";
import nextConfig from "./next.config";

/**
 * The response headers Next sets for `path`: every matching `headers()` entry applies in order,
 * and a later entry overrides an earlier one with the same key (next.config.js `headers` docs,
 * "Header Overriding Behavior"). Matching uses Next's own path-to-regexp wrapper.
 */
async function headersFor(path: string): Promise<Map<string, string>> {
  const routes = (await nextConfig.headers?.()) ?? [];
  const result = new Map<string, string>();
  for (const route of routes) {
    if (getPathMatch(route.source)(path) === false) continue;
    for (const { key, value } of route.headers) result.set(key.toLowerCase(), value);
  }
  return result;
}

describe("next.config headers", () => {
  it.each(["/sign-in", "/sign-in/confirm", "/invite/0192f0c4-0000-7000-8000-000000000000"])(
    "sends no Referer from %s",
    async (path) => {
      expect((await headersFor(path)).get("referrer-policy")).toBe("no-referrer");
    },
  );

  it.each(["/", "/settings/members", "/design-system", "/sign-inx", "/welcome"])(
    "keeps the default Referrer-Policy on %s",
    async (path) => {
      expect((await headersFor(path)).get("referrer-policy")).toBe(
        "strict-origin-when-cross-origin",
      );
    },
  );

  it("keeps the other security headers on sign-in pages", async () => {
    const headers = await headersFor("/sign-in");
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("gives API routes the static CSP", async () => {
    expect((await headersFor("/api/auth/sign-out")).get("content-security-policy")).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
  });
});
