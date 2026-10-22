import { readFileSync } from "node:fs";
import { join } from "node:path";

export const REPO_ROOT = join(import.meta.dirname, "../../..");

/**
 * The `repository:tag@digest` image `compose.yaml` pins for `repository` (e.g. `postgres`,
 * `axllent/mailpit`), so e2e runs against exactly what the stack runs.
 */
export function composeImage(repository: string): string {
  const compose = readFileSync(join(REPO_ROOT, "compose.yaml"), "utf8");
  const escaped = repository.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const image = new RegExp(`^\\s*image:\\s*(${escaped}:\\S+)\\s*$`, "m").exec(compose)?.[1];
  if (!image) throw new Error(`compose.yaml has no ${repository} image`);
  return image;
}

/** A variable global setup exports to workers (they inherit its environment). */
export function requiredEnv(name: `PLAYWRIGHT_${string}`): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; did global-setup.ts run?`);
  return value;
}
