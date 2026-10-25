import { readFileSync } from "node:fs";
import { join } from "node:path";

export const REPO_ROOT = join(import.meta.dirname, "../../..");

/**
 * The `repository:tag@digest` image `compose.yaml` pins for `repository` (e.g. `postgres`,
 * `axllent/mailpit`), so tests run against exactly what the stack runs, and a Dependabot bump
 * there moves them too.
 */
export function composeImage(
  repository: string,
  { file = join(REPO_ROOT, "compose.yaml") }: { file?: string } = {},
): string {
  const compose = readFileSync(file, "utf8");
  const escaped = repository.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const image = new RegExp(`^\\s*image:\\s*(${escaped}:\\S+)\\s*$`, "m").exec(compose)?.[1];
  if (!image) throw new Error(`compose.yaml has no ${repository} image`);
  return image;
}
