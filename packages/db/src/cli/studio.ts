// `pnpm db:studio`: Drizzle Studio on the database the other CLIs use. drizzle-kit takes only a URL,
// so this works out DATABASE_URL first (apps/web/.env.local when it's unset), writes the password
// file's contents into it, and starts `drizzle-kit studio` with that. Node runs this file directly
// (type stripping), so relative imports keep their `.ts` extension.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { connectionUrl } from "../config.ts";
import { describeDatabaseUrl, loadWebEnvFallback } from "./env.ts";

let envFile: string | undefined;
try {
  envFile = loadWebEnvFallback();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
const url = connectionUrl();
if (!url) {
  console.error("DATABASE_URL is not set, and apps/web/.env.local doesn't set it either.");
  process.exit(1);
}
console.log(`Drizzle Studio on ${describeDatabaseUrl(url)}${envFile ? ` (from ${envFile})` : ""}`);

const { DATABASE_PASSWORD_FILE: _passwordFile, ...env } = process.env;
// pnpm puts the package's node_modules/.bin on PATH, so `drizzle-kit` resolves to its own copy.
const studio = spawn("drizzle-kit", ["studio", ...process.argv.slice(2)], {
  cwd: join(import.meta.dirname, "../.."),
  env: { ...env, DATABASE_URL: url },
  stdio: "inherit",
});
studio.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
