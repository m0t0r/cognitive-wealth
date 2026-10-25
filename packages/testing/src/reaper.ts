import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./compose";

/** Pins Testcontainers' reaper for both harnesses; Dependabot bumps it (see the file's header). */
const PIN_FILE = join(REPO_ROOT, "docker/testcontainers/Dockerfile");

const PINNED = /^FROM\s+(testcontainers\/ryuk:[^@\s]+@sha256:[0-9a-f]+)\s*$/m;

/** The reaper image, `tag@digest`, from the pin file's `FROM` line. */
export function reaperImage({ file = PIN_FILE }: { file?: string } = {}): string {
  const image = PINNED.exec(readFileSync(file, "utf8"))?.[1];
  if (!image) throw new Error(`${file} must pin testcontainers/ryuk by tag@digest`);
  return image;
}

/**
 * Pins Testcontainers' reaper image (its default is tag-only), unless the environment already
 * names one. Call it before a run's first container starts: the reaper starts with that one.
 */
export function pinReaperImage() {
  process.env.RYUK_CONTAINER_IMAGE ??= reaperImage();
}
