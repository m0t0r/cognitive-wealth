import { readFileSync } from "node:fs";
import type { ConnectionConfig } from "./connect.ts";

/**
 * Reads the connection from `DATABASE_URL`. In containers, keep the password out of the
 * environment: leave it out of the URL and point `DATABASE_PASSWORD_FILE` at a mounted secret.
 */
export function connectionConfig(): ConnectionConfig {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const passwordFile = process.env.DATABASE_PASSWORD_FILE;
  return {
    url,
    password: passwordFile ? () => readFileSync(passwordFile, "utf8").trim() : undefined,
  };
}
