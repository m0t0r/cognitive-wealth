// `cw`, the repo's CLI for agents and operators (ADR 0026), on incur: each command declares its
// input and output as Zod schemas and returns data, which incur prints as TOON (or JSON with
// `--json`), with errors as `{ code, message, retryable, cta }`. `--help`, `--llms` and
// `--schema` come from the same schemas, so they can't drift from the code.
import { Cli } from "incur";
import { devCommands } from "./commands/dev.ts";
import { frictionCommands } from "./commands/friction.ts";
import { orgCommands } from "./commands/org.ts";
import { type Dependencies, defaultDependencies } from "./dependencies.ts";

/** Every command group `cw` mounts, apart from the root so a test can mount them on its own. */
export function commandGroups(dependencies: Dependencies) {
  return [orgCommands(dependencies), devCommands(dependencies), frictionCommands(dependencies)];
}

export function createCli(dependencies: Dependencies = defaultDependencies) {
  const cli = Cli.create("pnpm cw", {
    description: "Cognitive Wealth's commands, for agents and operators",
    // No MCP tools at all (ADR 0026): the repo's guardrails (the worktree hook, permission rules)
    // see only shell commands, and a write must never reach production around them. Each command
    // that writes also says `mcp: false`, so lifting this for a read-only one keeps writes out.
    mcp: { tools: { exclude: ["*"] } },
    // The skills and CLAUDE.md are written by hand; generated ones would compete with them.
    sync: false,
    // It runs from the checkout, never from a global install, so there's nothing to update.
    update: false,
  });
  for (const group of commandGroups(dependencies)) cli.command(group);
  return cli;
}

/**
 * pnpm 12 passes a literal `--` through to a script (#104), and incur takes it for an unknown
 * flag; no `cw` command takes arguments after one, so it's dropped wherever it is.
 */
export function withoutSeparator(argv: string[]): string[] {
  return argv.filter((arg) => arg !== "--");
}
