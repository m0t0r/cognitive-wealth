# ADR 0026: `cw`, one CLI for agents and operators, on incur, with no MCP tools

- Status: accepted
- Date: 2026-10-26

The repository's commands (`org:*`, `db:seed`, `custodian:ingest`, `dev:*`, `cve:scan`) are each a Node entry file on `node:util`'s `parseArgs`, a hand-written usage string and sentences on stdout. Agents run most of them: Claude Code sessions, the verifier-web skill's scripts and the `teardown-worktree` hook. They learn them from CLAUDE.md's prose, read results back out of sentences, and get every failure as a message with exit code 1, whether it's a typo, a refusal or a crash. The CLIs handle pnpm 12's literal `--` (#104) four different ways, and testing what an entry file prints or exits with takes a Node subprocess per case.

1. **One entry, `pnpm cw <group> <command>`** (`packages/cli`, `@repo/cli`), on [incur](https://github.com/wevm/incur). Each command declares its options and its output as Zod schemas, and returns data. `--help`, `--llms` (the command manifest) and `--schema` are generated from those schemas.
2. **Output is data.** incur prints TOON by default (YAML-like, fewer tokens than JSON), and JSON with `--json` or `--format json`. A failure prints `{ code, message, retryable, cta? }` and exits 1. `code` is `invalid_input` or a named refusal (`unknown_organization`, `already_deactivated`, `prune_failed`, …) from `CliError` (`@repo/db/cli/cli-error`), a Node error's own code (`ECONNREFUSED`), incur's `VALIDATION_ERROR` with the field, or `UNKNOWN` for a bug.
3. **Next steps are part of the result.** A command suggests what to run next as incur's call-to-actions (`cta`): the undo after `org deactivate`, the real run after a `--dry-run`, the retry after `prune_failed`.
4. **Every command that writes takes `--dry-run`.** It reports what the command would do, in the same shape, and writes nothing. `org deactivate` and `org reactivate` run their transaction and roll it back, so a dry run makes every check and count a real run makes.
5. **No MCP tools.** incur gives every CLI an MCP server (`--mcp`, `mcp add`, and an HTTP endpoint on `cli.fetch`). `cw`'s root excludes every tool (`mcp: { tools: { exclude: ["*"] } }`), and every command that writes also says `mcp: false`. `app.test.ts` checks both: `cw`'s MCP server lists nothing, and on a root without the exclusion every `cw` command stays hidden. A read-only command may be exposed one day, by its own change to this ADR; a command that writes, never.
6. **`cli.fetch` is never served.** incur's fetch handler runs any command over HTTP, `mcp: false` or not. Only tests call it, in-process, to reach the MCP endpoint.
7. **incur's other built-ins are off where they act on their own**: generated skill files (`sync: false`) and self-update (`update: false`).
8. **Tests run commands in-process.** `createCli(dependencies)` takes the database and the dev environment as one object, and `serve(argv, { stdout, exit })` runs the real command with a test's own. The domain keeps its rules and their tests; `cw`'s tests own the wiring: options, output shape, codes and exit status.
9. **The old script names stay**, as aliases of `cw` commands (`pnpm org:deactivate` is `cw org deactivate`), so the docs, runbooks and muscle memory that name them keep working. The rest of the CLIs move over one group at a time (#234), tracked in #232.

## Why

- **Agents are the main users.** The CLIs it replaces were written for a person reading a terminal. An agent does better with a manifest it can ask for than with prose in every session's context, with fields than with sentences, and with a code it can branch on than with a message it has to interpret.
- **incur over writing it ourselves.** The parts we'd build anyway are exactly incur's core: Zod-typed options, a result envelope, error codes, CTAs, a generated manifest, injected I/O for tests. It adds token-aware output (`--filter-output`, `--token-limit`) and shell completion for free.
- **incur over Stricli, Optique or Commander.** Those parse arguments well and test cleanly, but none has a result envelope, error codes or a manifest; we'd write the agent contract on top of each.
- **No MCP, because the guardrails see only shell commands.** The worktree hook and Claude Code's permission rules decide what an agent may run by reading its Bash command. An MCP tool call goes around both, so a command that writes to production would be one tool call away with no check. Agents already run shell commands well; MCP would add a second door, not a capability.

## Considered options

- **Keep `parseArgs`, add `--json` to each CLI.** Fixes the output but leaves the copied plumbing, the separate usage strings and the subprocess tests.
- **Our own ~150-line layer on Zod.** No new dependency, and we'd own its stability; but we'd write and maintain what incur already has, and fall behind its agent features.
- **Stricli** (Bloomberg): commands are functions and its context is injectable, but output and errors stay ours to design.
- **incur with MCP on, read-only commands only.** Deferred: `cw` has no read-only command yet, and the repo's guardrails would still not see those calls.

## Consequences

- **A young dependency.** incur is pre-1.0 (0.7.1, about 100 releases since February 2026), so `@repo/cli` pins it exactly and an upgrade is a change of its own, checked with `pnpm test` and `pnpm test:integration`. It brings seven dependencies, the MCP SDK (`2.0.0-alpha.4`) among them, into a process that holds production database credentials; the weekly cve.now scan (ADR 0024) covers them like any other.
- **Its MCP server still starts.** `cw --mcp` and `cw mcp add` exist and answer, with no tools. Registering it does nothing harmful, and only a change to `app.ts` could give it tools.
- **Exit codes don't tell a refusal from a bug.** Both exit 1, as incur does; the code in the output tells them apart.
- **One process loads the commands it runs.** Each command imports its domain modules when it runs, so `cw dev prune` doesn't load the database schema, and `cw org …` doesn't load `@repo/dev-env`.
- **People get the same fields.** In a terminal incur prints the data formatted for reading, and `--format yaml` or `md` is there for anyone who wants another form. The sentences the old CLIs printed are gone.
