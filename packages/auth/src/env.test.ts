import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { authOptionsFromEnv, type AuthEnv } from "./env";

const SECRET = "s".repeat(32);

function secretFile(contents: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "auth-env-")), "secret");
  writeFileSync(path, contents);
  return path;
}

const production: AuthEnv = {
  NODE_ENV: "production",
  BETTER_AUTH_URL: "https://app.example",
  BETTER_AUTH_SECRET: SECRET,
  AUTH_TRUSTED_IP_HEADER: "cf-connecting-ip",
  REDIS_URL: "redis://app@redis:6379",
};

describe("authOptionsFromEnv", () => {
  it("reads a complete production environment", () => {
    expect(authOptionsFromEnv(production)).toEqual({
      baseURL: "https://app.example",
      secret: SECRET,
      trustedIpHeader: "cf-connecting-ip",
      trustedProxies: undefined,
      secureCookies: true,
      redis: { url: "redis://app@redis:6379", password: undefined, keyPrefix: "cw:" },
    });
  });

  it("uses dev defaults outside production", () => {
    expect(
      authOptionsFromEnv({
        PORTLESS_URL: "https://cognitive-wealth.localhost",
        BETTER_AUTH_SECRET: "dev",
      }),
    ).toEqual({
      baseURL: "https://cognitive-wealth.localhost",
      secret: "dev",
      trustedIpHeader: undefined,
      trustedProxies: undefined,
      secureCookies: true,
      redis: { url: "redis://localhost:6379", password: undefined, keyPrefix: "cw:" },
    });
  });

  it("prefers BETTER_AUTH_URL over PORTLESS_URL, and turns Secure off on http outside production", () => {
    const options = authOptionsFromEnv({
      BETTER_AUTH_URL: "http://localhost:3000",
      PORTLESS_URL: "https://cognitive-wealth.localhost",
      BETTER_AUTH_SECRET: "dev",
    });
    expect(options.baseURL).toBe("http://localhost:3000");
    expect(options.secureCookies).toBe(false);
  });

  it("keeps Secure cookies on in production over http (loopback deployments)", () => {
    expect(
      authOptionsFromEnv({ ...production, BETTER_AUTH_URL: "http://127.0.0.1:3000" }).secureCookies,
    ).toBe(true);
  });

  it("treats blank variables as unset", () => {
    expect(() => authOptionsFromEnv({ ...production, AUTH_TRUSTED_IP_HEADER: "  " })).toThrow(
      "AUTH_TRUSTED_IP_HEADER must be set in production",
    );
  });

  describe("production guards", () => {
    it.each(["http://app.example", "http://10.0.0.5:3000", "http://localhost.example.com"])(
      "requires https for %s, which isn't this machine",
      (url) => {
        expect(() => authOptionsFromEnv({ ...production, BETTER_AUTH_URL: url })).toThrow(
          "BETTER_AUTH_URL must use https in production, except on localhost",
        );
      },
    );

    it.each(["http://localhost:3000", "http://127.0.0.1:41234", "http://[::1]:3000"])(
      "allows http on this machine (%s)",
      (url) => {
        expect(authOptionsFromEnv({ ...production, BETTER_AUTH_URL: url }).baseURL).toBe(
          new URL(url).origin,
        );
      },
    );

    it("requires BETTER_AUTH_URL, without the PORTLESS_URL fallback", () => {
      expect(() =>
        authOptionsFromEnv({
          ...production,
          BETTER_AUTH_URL: undefined,
          PORTLESS_URL: "https://x.localhost",
        }),
      ).toThrow(/BETTER_AUTH_URL must be set/);
    });

    it("requires a secret of at least 32 characters", () => {
      expect(() =>
        authOptionsFromEnv({ ...production, BETTER_AUTH_SECRET: "s".repeat(31) }),
      ).toThrow(/at least 32 characters/);
    });

    it("requires AUTH_TRUSTED_IP_HEADER", () => {
      expect(() =>
        authOptionsFromEnv({ ...production, AUTH_TRUSTED_IP_HEADER: undefined }),
      ).toThrow("AUTH_TRUSTED_IP_HEADER must be set in production");
    });

    it("requires REDIS_URL", () => {
      expect(() => authOptionsFromEnv({ ...production, REDIS_URL: undefined })).toThrow(
        /REDIS_URL/,
      );
    });
  });

  describe("secret", () => {
    it("reads and trims BETTER_AUTH_SECRET_FILE", () => {
      const env = {
        ...production,
        BETTER_AUTH_SECRET: undefined,
        BETTER_AUTH_SECRET_FILE: secretFile(`${SECRET}\n`),
      };
      expect(authOptionsFromEnv(env).secret).toBe(SECRET);
    });

    it("refuses both a secret and a secret file", () => {
      expect(() =>
        authOptionsFromEnv({ ...production, BETTER_AUTH_SECRET_FILE: secretFile(SECRET) }),
      ).toThrow("Set only one of BETTER_AUTH_SECRET and BETTER_AUTH_SECRET_FILE");
    });

    it("refuses a missing secret, an unreadable file and an empty file", () => {
      expect(() => authOptionsFromEnv({ ...production, BETTER_AUTH_SECRET: undefined })).toThrow(
        /must be set/,
      );
      expect(() =>
        authOptionsFromEnv({
          ...production,
          BETTER_AUTH_SECRET: undefined,
          BETTER_AUTH_SECRET_FILE: "/nope/secret",
        }),
      ).toThrow("Could not read BETTER_AUTH_SECRET_FILE");
      expect(() =>
        authOptionsFromEnv({
          ...production,
          BETTER_AUTH_SECRET: undefined,
          BETTER_AUTH_SECRET_FILE: secretFile(" \n"),
        }),
      ).toThrow("BETTER_AUTH_SECRET_FILE is empty");
    });

    it("never puts the secret in an error message", () => {
      const secret = "short-but-very-recognizable";
      expect(() => authOptionsFromEnv({ ...production, BETTER_AUTH_SECRET: secret })).toThrow(
        expect.objectContaining({ message: expect.not.stringContaining(secret) }),
      );
    });
  });

  describe("base URL", () => {
    it.for([
      "not a url",
      "ftp://app.example",
      "https://app.example/app",
      "https://app.example/?x=1",
      "https://user:pass@app.example",
      "javascript:alert(1)",
    ])("refuses %s", (url) => {
      expect(() => authOptionsFromEnv({ ...production, BETTER_AUTH_URL: url })).toThrow(
        /BETTER_AUTH_URL/,
      );
    });

    it("normalizes to the origin", () => {
      expect(
        authOptionsFromEnv({ ...production, BETTER_AUTH_URL: "https://APP.example:443/" }).baseURL,
      ).toBe("https://app.example");
    });
  });

  describe("client IP", () => {
    it("lowercases the header and parses trusted proxies", () => {
      const options = authOptionsFromEnv({
        ...production,
        AUTH_TRUSTED_IP_HEADER: "X-Forwarded-For",
        AUTH_TRUSTED_PROXIES: " 10.0.0.0/8, 192.168.1.1 ,fd00::/8,",
      });
      expect(options.trustedIpHeader).toBe("x-forwarded-for");
      expect(options.trustedProxies).toEqual(["10.0.0.0/8", "192.168.1.1", "fd00::/8"]);
    });

    it.for(["10.0.0.0/33", "fd00::/129", "example.com", "10.0.0.1/8/8", "10.0.0/8", "10.0.0.0/x"])(
      "refuses the trusted proxy %s",
      (entry) => {
        expect(() => authOptionsFromEnv({ ...production, AUTH_TRUSTED_PROXIES: entry })).toThrow(
          /AUTH_TRUSTED_PROXIES/,
        );
      },
    );

    it("refuses a header that isn't a header name", () => {
      expect(() =>
        authOptionsFromEnv({ ...production, AUTH_TRUSTED_IP_HEADER: "x forwarded" }),
      ).toThrow("AUTH_TRUSTED_IP_HEADER must be a header name");
    });
  });

  describe("redis", () => {
    it("reads the password file and the key prefix", () => {
      const options = authOptionsFromEnv({
        ...production,
        REDIS_PASSWORD_FILE: secretFile("hunter2\n"),
        REDIS_KEY_PREFIX: "cw:e2e-1:",
      });
      expect(options.redis).toEqual({
        url: "redis://app@redis:6379",
        password: "hunter2",
        keyPrefix: "cw:e2e-1:",
      });
    });

    it.for(["app:", "cw", "xcw:", "cw: spaces", "cw:*"])("refuses the key prefix %j", (prefix) => {
      expect(() => authOptionsFromEnv({ ...production, REDIS_KEY_PREFIX: prefix })).toThrow(
        /REDIS_KEY_PREFIX/,
      );
    });

    it("refuses a non-redis URL and an unreadable password file", () => {
      expect(() => authOptionsFromEnv({ ...production, REDIS_URL: "http://redis" })).toThrow(
        /REDIS_URL/,
      );
      expect(() => authOptionsFromEnv({ ...production, REDIS_PASSWORD_FILE: "/nope" })).toThrow(
        "Could not read REDIS_PASSWORD_FILE",
      );
    });
  });
});
