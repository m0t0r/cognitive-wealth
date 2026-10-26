// `cw dev prune`: tears down every worktree environment whose worktree git no longer lists
// (`@repo/dev-env`'s `prune`). The `teardown-worktree` hook runs it after a worktree removal and at
// the start and end of every session, and `pnpm dev` runs the same sweep on start; by hand it's for
// a check (`--dry-run`) or a retry. It writes to the dev services only, but still isn't an MCP tool
// (ADR 0026).
import { Cli, z } from "incur";
import type { Dependencies } from "../dependencies.ts";
import { refusal } from "../refusal.ts";

const output = z.object({
  dryRun: z.boolean().describe("true when nothing was torn down"),
  removed: z.array(z.string()).describe("One line per thing torn down; empty with --dry-run"),
  orphans: z
    .array(
      z.object({
        database: z.string(),
        redisPrefix: z.string(),
        pid: z.number().optional().describe("Its pnpm dev, if one is running"),
      }),
    )
    .describe("The environments of removed worktrees; with --dry-run, what would go"),
  servers: z
    .array(z.object({ pid: z.number(), cwd: z.string() }))
    .describe("pnpm dev processes found only in the process table, in no live checkout"),
});

export function devCommands({ devEnv }: Pick<Dependencies, "devEnv">) {
  return Cli.create("dev", { description: "The dev environments of git worktrees" }).command(
    "prune",
    {
      description:
        "Tear down every worktree environment whose worktree is gone: its database, Redis keys, " +
        "pnpm dev, and what verifier-web left for it",
      hint: "Only worktrees git no longer lists are touched, so it's safe to run at any time.",
      options: z.object({
        dryRun: z.boolean().default(false).describe("List what would be torn down, and stop"),
      }),
      output,
      mcp: false,
      async run(c) {
        try {
          const { mainCheckout, findOrphans, prune } = await devEnv();
          const { environments, servers } = await findOrphans(mainCheckout);
          const found = {
            orphans: environments.map(({ database, redisPrefix, server }) => ({
              database,
              redisPrefix,
              pid: server?.pid,
            })),
            servers: servers.map(({ pid, cwd }) => ({ pid, cwd })),
          };
          if (c.options.dryRun) return { dryRun: true, removed: [], ...found };
          const { removed, failed } = await prune(mainCheckout);
          if (failed.length > 0) {
            return c.error({
              code: "prune_failed",
              message: [`Tore down ${removed.length}, and failed on:`, ...failed].join("\n"),
              retryable: true,
              cta: {
                commands: [{ command: "dev prune", description: "Retry once the cause is fixed" }],
              },
            });
          }
          return { dryRun: false, removed, ...found };
        } catch (error) {
          return c.error(refusal(error));
        }
      },
    },
  );
}
