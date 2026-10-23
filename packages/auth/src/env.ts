import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import * as z from "zod";
import { REDIS_KEY_NAMESPACE } from "./storage/redis";

export type AuthEnv = Record<string, string | undefined>;

export interface AuthEnvOptions {
  /** The app's origin, e.g. `https://app.example.com` (no path). */
  baseURL: string;
  secret: string;
  /** The single header the edge proxy sets to the client IP; unset outside production only. */
  trustedIpHeader: string | undefined;
  /** IPs or CIDRs of proxies that append to `trustedIpHeader`. */
  trustedProxies: string[] | undefined;
  /** Secure cookies: always in production, otherwise only on https. */
  secureCookies: boolean;
  redis: { url: string; password: string | undefined; keyPrefix: string };
}

export const DEV_REDIS_URL = "redis://localhost:6379";
const MIN_PRODUCTION_SECRET_LENGTH = 32;

// An unset or blank variable counts as missing.
const optional = z
  .string()
  .optional()
  .transform((value) => (value?.trim() ? value.trim() : undefined));

const schema = z.object({
  NODE_ENV: optional,
  BETTER_AUTH_URL: optional,
  PORTLESS_URL: optional,
  BETTER_AUTH_SECRET: optional,
  BETTER_AUTH_SECRET_FILE: optional,
  AUTH_TRUSTED_IP_HEADER: optional,
  AUTH_TRUSTED_PROXIES: optional,
  REDIS_URL: optional,
  REDIS_PASSWORD_FILE: optional,
  REDIS_KEY_PREFIX: optional,
});

/**
 * Reads the auth settings (see ADR 0001 for each variable). Throws with a message naming the
 * variable, never its value. In production (`NODE_ENV=production`) it requires `BETTER_AUTH_URL`
 * (no `PORTLESS_URL` fallback), a secret of at least 32 characters, `AUTH_TRUSTED_IP_HEADER`
 * (otherwise every client shares one rate-limit bucket) and `REDIS_URL`.
 */
export function authOptionsFromEnv(env: AuthEnv): AuthEnvOptions {
  const vars = schema.parse(env);
  const production = vars.NODE_ENV === "production";

  const baseURL = parseBaseURL(
    vars.BETTER_AUTH_URL ?? (production ? undefined : vars.PORTLESS_URL),
    production,
  );

  const secret = readSecret(vars.BETTER_AUTH_SECRET, vars.BETTER_AUTH_SECRET_FILE);
  if (production && secret.length < MIN_PRODUCTION_SECRET_LENGTH) {
    throw new Error(
      `BETTER_AUTH_SECRET must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters`,
    );
  }

  const trustedIpHeader = vars.AUTH_TRUSTED_IP_HEADER?.toLowerCase();
  if (trustedIpHeader === undefined && production) {
    throw new Error("AUTH_TRUSTED_IP_HEADER must be set in production");
  }
  if (trustedIpHeader !== undefined && !/^[a-z0-9-]+$/.test(trustedIpHeader)) {
    throw new Error("AUTH_TRUSTED_IP_HEADER must be a header name");
  }

  const trustedProxies = vars.AUTH_TRUSTED_PROXIES?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (trustedProxies?.some((entry) => !isIpOrCidr(entry))) {
    throw new Error("AUTH_TRUSTED_PROXIES must be comma-separated IPs or CIDR ranges");
  }

  return {
    baseURL,
    secret,
    trustedIpHeader,
    trustedProxies: trustedProxies?.length ? trustedProxies : undefined,
    secureCookies: production || baseURL.startsWith("https:"),
    redis: redisOptions(vars, production),
  };
}

function parseBaseURL(value: string | undefined, production: boolean): string {
  if (value === undefined) {
    throw new Error("BETTER_AUTH_URL must be set (outside production, PORTLESS_URL also works)");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("BETTER_AUTH_URL must be an absolute URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("BETTER_AUTH_URL must use http or https");
  }
  // Sign-in links carry their token in the fragment, which anyone who can rewrite plain-http
  // pages could read. Plain http is only for this machine (the Compose stack, e2e).
  if (production && url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
    throw new Error("BETTER_AUTH_URL must use https in production, except on localhost");
  }
  // Links and the origin check are built from the origin alone; a path here would be ignored or
  // half-applied, so refuse it.
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("BETTER_AUTH_URL must be an origin, without credentials, path or query");
  }
  return url.origin;
}

function readSecret(value: string | undefined, file: string | undefined): string {
  if (value !== undefined && file !== undefined) {
    throw new Error("Set only one of BETTER_AUTH_SECRET and BETTER_AUTH_SECRET_FILE");
  }
  if (value !== undefined) return value;
  if (file === undefined)
    throw new Error("BETTER_AUTH_SECRET or BETTER_AUTH_SECRET_FILE must be set");
  let contents: string;
  try {
    contents = readFileSync(file, "utf8").trim();
  } catch {
    throw new Error("Could not read BETTER_AUTH_SECRET_FILE");
  }
  if (contents === "") throw new Error("BETTER_AUTH_SECRET_FILE is empty");
  return contents;
}

function redisOptions(vars: z.infer<typeof schema>, production: boolean): AuthEnvOptions["redis"] {
  const url = vars.REDIS_URL ?? (production ? undefined : DEV_REDIS_URL);
  if (url === undefined) throw new Error("REDIS_URL must be set in production");
  if (!URL.canParse(url) || !["redis:", "rediss:"].includes(new URL(url).protocol)) {
    throw new Error("REDIS_URL must be a redis:// or rediss:// URL");
  }

  let password: string | undefined;
  if (vars.REDIS_PASSWORD_FILE !== undefined) {
    try {
      password = readFileSync(vars.REDIS_PASSWORD_FILE, "utf8").trim();
    } catch {
      throw new Error("Could not read REDIS_PASSWORD_FILE");
    }
    if (password === "") throw new Error("REDIS_PASSWORD_FILE is empty");
  }

  const keyPrefix = vars.REDIS_KEY_PREFIX ?? REDIS_KEY_NAMESPACE;
  if (!keyPrefix.startsWith(REDIS_KEY_NAMESPACE) || !/^[A-Za-z0-9:_-]+$/.test(keyPrefix)) {
    throw new Error(
      `REDIS_KEY_PREFIX must start with "${REDIS_KEY_NAMESPACE}" (letters, digits, :_-)`,
    );
  }
  return { url, password, keyPrefix };
}

function isIpOrCidr(entry: string): boolean {
  const [ip = "", prefix, ...rest] = entry.split("/");
  if (rest.length > 0) return false;
  const family = isIP(ip);
  if (family === 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

// Re-exported for `apps/web`, which builds the mailer next to the auth options but doesn't depend
// on `@repo/email` itself.
export { mailerFromEnv } from "@repo/email";

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  );
}
