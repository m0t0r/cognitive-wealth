import { readFileSync } from "node:fs";
import { join } from "node:path";

export const REPO_ROOT = join(import.meta.dirname, "../../..");

/**
 * The `repository:tag@digest` image `compose.yaml` pins for `repository` (e.g. `postgres`,
 * `axllent/mailpit`), so tests run against exactly what the stack runs, and a Dependabot bump
 * there moves them too. Several services may use one repository (`db` and `custodian-db` both
 * run `postgres`); they must pin it alike, or a bump to one would leave the tests on the other.
 */
export function composeImage(
  repository: string,
  { file = join(REPO_ROOT, "compose.yaml") }: { file?: string } = {},
): string {
  const compose = readFileSync(file, "utf8");
  const escaped = repository.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const pattern = new RegExp(`^\\s*image:\\s*(${escaped}:\\S+)\\s*$`, "gm");
  const images = new Set(compose.matchAll(pattern).map((match) => match[1]!));
  if (images.size > 1) {
    throw new Error(`compose.yaml pins ${repository} differently: ${[...images].join(", ")}`);
  }
  const [image] = images;
  if (!image) throw new Error(`compose.yaml has no ${repository} image`);
  return image;
}
