// `cw db seed`'s and `cw custodian ingest`'s own calls, as `@repo/dev-env`'s `populate` takes them:
// `cw verify` seeds and ingests a verification database with them, and `cw dev env` a new
// worktree's database (#223).
import { CliError } from "@repo/db/cli/cli-error";
import type { DomainCalls } from "@repo/dev-env/populate";
import type { Dependencies } from "./dependencies.ts";

/** For this checkout's code only, since a `--ref`'s schema may differ. */
export async function domainCalls(
  openDatabase: Dependencies["openDatabase"],
): Promise<DomainCalls> {
  const { WORLD_FILE, seed } = await import("./commands/db.ts");
  const { WORLD_FIRM, ingest } = await import("./commands/custodian.ts");
  return {
    async seed(target) {
      await seed({
        world: WORLD_FILE,
        dryRun: false,
        openDatabase: () => openDatabase({ target }),
      });
    },
    async ingest({ target, asOf, root }) {
      const { result } = await ingest({
        asOf,
        firm: WORLD_FIRM,
        root,
        dryRun: false,
        openDatabase: () => openDatabase({ target }),
      });
      if (result.status === "refused") {
        throw new CliError({
          code: result.reason,
          message: `Refused the example Delivery for ${asOf}: ${result.message}.`,
        });
      }
      return result.status;
    },
  };
}
