import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  EMPTY_STYLE_HASH,
  SONNER_STYLE_HASH,
  contentSecurityPolicy,
  staticSecurityHeaders,
} from "./security-headers";

function styleHash(css: string): string {
  return `'sha256-${createHash("sha256").update(css).digest("base64")}'`;
}

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(";").map((directive) => {
      const [name = "", ...sources] = directive.trim().split(/\s+/);
      return [name, sources];
    }),
  );
}

describe("contentSecurityPolicy", () => {
  const production = directives(contentSecurityPolicy("abc123"));

  // securityheaders.com caps the grade at A for these in script-src (or default-src).
  it("allows no inline or eval'd script in production", () => {
    for (const name of ["script-src", "default-src"]) {
      expect(production.get(name)).not.toContain("'unsafe-inline'");
      expect(production.get(name)).not.toContain("'unsafe-eval'");
    }
  });

  it("trusts scripts and style elements by nonce", () => {
    expect(production.get("script-src")).toEqual(
      expect.arrayContaining(["'nonce-abc123'", "'strict-dynamic'"]),
    );
    expect(production.get("style-src")).toContain("'nonce-abc123'");
    expect(production.get("style-src")).not.toContain("'unsafe-inline'");
  });

  it("locks down plugins, base URIs and framing", () => {
    expect(production.get("object-src")).toEqual(["'none'"]);
    expect(production.get("base-uri")).toEqual(["'none'"]);
    expect(production.get("frame-ancestors")).toEqual(["'none'"]);
  });

  it("relaxes only what next dev needs", () => {
    const dev = directives(contentSecurityPolicy("abc123", { dev: true }));
    expect(dev.get("script-src")).toContain("'unsafe-eval'");
    expect(dev.get("style-src")).toContain("'unsafe-inline'");
  });

  it("allows exactly the stylesheet the installed sonner injects", async () => {
    const bundle = await readFile(fileURLToPath(import.meta.resolve("sonner")), "utf8");
    const literal = /__insertCSS\(("(?:[^"\\]|\\.)*")\)/.exec(bundle)?.[1];
    expect(literal, "sonner no longer injects its CSS this way").toBeDefined();
    const css: unknown = JSON.parse(literal ?? '""');
    expect(typeof css).toBe("string");
    expect(SONNER_STYLE_HASH).toBe(styleHash(String(css)));
  });

  it("allows the empty stylesheet sonner appends before filling it", () => {
    expect(EMPTY_STYLE_HASH).toBe(styleHash(""));
  });
});

describe("staticSecurityHeaders", () => {
  it("sends every header securityheaders.com grades", () => {
    const keys = staticSecurityHeaders().map((header) => header.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "Strict-Transport-Security",
        "X-Frame-Options",
        "X-Content-Type-Options",
        "Referrer-Policy",
        "Permissions-Policy",
      ]),
    );
  });

  it("can leave out HSTS so dev hosts are never pinned to HTTPS", () => {
    const keys = staticSecurityHeaders({ hsts: false }).map((header) => header.key);
    expect(keys).not.toContain("Strict-Transport-Security");
  });
});
