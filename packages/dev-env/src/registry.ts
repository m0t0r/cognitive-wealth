// What each worktree's setup created, kept in the main checkout's `.dev/worktree-env/` so teardown
// and prune still find it after the worktree is gone. Prune doesn't rely on it alone: it also finds
// databases and Redis keys by name. Node runs the CLIs that import this directly (type stripping),
// so relative imports keep their `.ts` extension.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorktreeResources } from "./names.ts";

export type WorktreeRecord = WorktreeResources & {
  id: string;
  /** The worktree's root when setup ran. */
  path: string;
  /** The running `pnpm dev`, while there is one. */
  server?: {
    /** The `dev.ts` wrapper. */
    pid: number;
    /** `next dev`'s process group, which the wrapper started detached. */
    group: number;
  };
};

const directory = (mainCheckout: string) => join(mainCheckout, ".dev/worktree-env");
const fileOf = ({ mainCheckout, token }: { mainCheckout: string; token: string }) =>
  join(directory(mainCheckout), `${token}.json`);

// Only this package writes these files, so they're trusted as written.
function parseRecord(file: string): WorktreeRecord {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function readRecords(mainCheckout: string): WorktreeRecord[] {
  const dir = directory(mainCheckout);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => parseRecord(join(dir, name)));
}

export function readRecord({ mainCheckout, token }: { mainCheckout: string; token: string }) {
  const file = fileOf({ mainCheckout, token });
  return existsSync(file) ? parseRecord(file) : undefined;
}

export function writeRecord({
  mainCheckout,
  record,
}: {
  mainCheckout: string;
  record: WorktreeRecord;
}) {
  mkdirSync(directory(mainCheckout), { recursive: true });
  writeFileSync(
    fileOf({ mainCheckout, token: record.token }),
    `${JSON.stringify(record, null, 2)}\n`,
  );
}

export function deleteRecord({ mainCheckout, token }: { mainCheckout: string; token: string }) {
  rmSync(fileOf({ mainCheckout, token }), { force: true });
}
