import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "orval";
import { custodianClient } from "../orval.config.ts";

const GENERATED = join(import.meta.dirname, "generated");

function contents(directory: string): Record<string, string> {
  const files = readdirSync(directory, { recursive: true, withFileTypes: true });
  return Object.fromEntries(
    files
      .filter((file) => file.isFile())
      .map((file) => {
        const path = join(file.parentPath, file.name);
        return [path.slice(directory.length), readFileSync(path, "utf8")];
      }),
  );
}

it("is what Orval generates from the committed openapi.json", async () => {
  // After the custodian's contract changes, regenerate with
  // `pnpm --filter @repo/custodian-client generate` and commit src/generated/.
  const directory = mkdtempSync(join(tmpdir(), "custodian-client-"));
  try {
    await generate(custodianClient(directory));

    expect(contents(GENERATED)).toEqual(contents(directory));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
