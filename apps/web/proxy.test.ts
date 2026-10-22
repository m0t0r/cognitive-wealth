import { describe, expect, it } from "vitest";
import { config } from "./proxy";

// Next compiles the matcher with path-to-regexp; its custom group behaves like this plain regex.
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
