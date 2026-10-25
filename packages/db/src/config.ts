import { readFileSync } from "node:fs";
import type { ConnectionConfig } from "./connect.ts";

/**
 * Reads the connection from `DATABASE_URL`. In containers, keep the password out of the
 * environment: leave it out of the URL and point `DATABASE_PASSWORD_FILE` at a mounted secret.
 */
/**
 * `DATABASE_URL` with the password from `DATABASE_PASSWORD_FILE` written into it, for tools that
 * take only a URL, such as `drizzle-kit studio`. Undefined without `DATABASE_URL`.
 */
export function connectionUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const url = env.DATABASE_URL;
  if (!url || !env.DATABASE_PASSWORD_FILE) return url;
  const withPassword = new URL(url);
  withPassword.password = encodeURIComponent(
    readFileSync(env.DATABASE_PASSWORD_FILE, "utf8").trim(),
  );
  return withPassword.toString();
}

export function connectionConfig(): ConnectionConfig {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const passwordFile = process.env.DATABASE_PASSWORD_FILE;
  return {
    url,
    password: passwordFile ? () => readFileSync(passwordFile, "utf8").trim() : undefined,
  };
}
