import { describe, expect, it } from "vitest";
import { callbackPathOrDefault, sanitizeCallbackPath } from "./callback-path";

describe("sanitizeCallbackPath", () => {
  it.for([
    ["/", "/"],
    ["/settings/members", "/settings/members"],
    [
      "/invite/0199f0a2-7c3e-7a1b-9c2d-1e2f3a4b5c6d",
      "/invite/0199f0a2-7c3e-7a1b-9c2d-1e2f3a4b5c6d",
    ],
    ["/search?q=a%20b&page=2", "/search?q=a%20b&page=2"],
    ["/docs#section-2", "/docs#section-2"],
    ["/a/./b/../c", "/a/c"],
    ["/caf%C3%A9", "/caf%C3%A9"],
    ["/?next=/elsewhere", "/?next=/elsewhere"],
  ])("accepts %s as %s", ([input, expected]) => {
    expect(sanitizeCallbackPath(input)).toBe(expected);
  });

  it.for([
    // Protocol-relative and absolute URLs.
    "//evil.com",
    "///evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "https://evil.com",
    "http:evil.com",
    "//evil.com/%2F..",
    // Schemes.
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox",
    // Encoded variants of the above.
    "/%2F%2Fevil.com",
    "/%2f%2fevil.com",
    "/%5Cevil.com",
    "/%5cevil.com",
    "%2F%2Fevil.com",
    "/%252F%252Fevil.com",
    "/%25252F%25252Fevil.com",
    "/%2525252F%2525252Fevil.com",
    "%2Fpath",
    // Dot segments that collapse into `//`.
    "/.//evil.com",
    "/a/..//evil.com",
    "/%2e//evil.com",
    "/a/%2e%2e//evil.com",
    // Control characters and whitespace, raw or encoded.
    "/\t/evil.com",
    "/\n/evil.com",
    "/\r\nSet-Cookie:x",
    "/\u0000",
    "/\u007f",
    "/%09/evil.com",
    "/%5C%5Cevil.com",
    "/a%5Cb",
    "/%0d%0aLocation:%20https://evil.com",
    "/%00",
    "/ path",
    "/path with space",
    // Characters outside the allowed set.
    "/<script>",
    '/"quoted"',
    "/a\\b",
    "/{x}",
    "/é",
    // Not relative at all.
    "",
    "evil.com",
    "./relative",
    "../up",
    "?query",
    "#hash",
    // Malformed escapes.
    "/%",
    "/%zz",
    "/%E0%A4%A",
  ])("refuses %j", (input) => {
    expect(sanitizeCallbackPath(input)).toBeNull();
  });

  it("refuses non-strings and overlong paths", () => {
    for (const input of [undefined, null, 1, ["/"], { path: "/" }]) {
      expect(sanitizeCallbackPath(input)).toBeNull();
    }
    expect(sanitizeCallbackPath(`/${"a".repeat(2048)}`)).toBeNull();
    expect(sanitizeCallbackPath(`/${"a".repeat(2046)}`)).not.toBeNull();
  });

  it("always returns something that resolves to the same origin", () => {
    for (const input of ["/x", "/a/../b", "/?a=//b", "/#//b"]) {
      const result = sanitizeCallbackPath(input)!;
      expect(new URL(result, "https://app.example").origin).toBe("https://app.example");
    }
  });
});

describe("callbackPathOrDefault", () => {
  it("falls back to /", () => {
    expect(callbackPathOrDefault("//evil.com")).toBe("/");
    expect(callbackPathOrDefault(null)).toBe("/");
    expect(callbackPathOrDefault("/ok")).toBe("/ok");
  });
});
