# @repo/friction-bot

Friction reports on GitHub, and the Claude calls that triage and fix them. A friction report is an issue an agent files at the end of a task for whatever slowed it down: a stale doc, a missing command, an unclear error ([`docs/agents/friction.md`](../../docs/agents/friction.md) says what counts and how to file one). This package holds the rules for every step after that: filing a report, triaging it, gathering a batch for the fixer, the fixer's tool loop, the commit gate, the bot's branch and PR, and relabelling each report from what happened to it.

It has no command of its own. `pnpm cw friction …` ([`packages/cli/src/commands/friction.ts`](../cli/src/commands/friction.ts)) owns the options, output and error codes, and calls in here; the two workflows, [`friction-triage.yml`](../../.github/workflows/friction-triage.yml) and [`friction-fix.yml`](../../.github/workflows/friction-fix.yml), run those commands. It's imported as source, like the other workspace packages, and runs under Node's type stripping.

## A report's life

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../docs/diagrams/friction-lifecycle.dark.svg">
  <img alt="An agent session ends and files a report with pnpm cw friction report, which labels the issue friction. When the label lands, friction-triage.yml runs cw friction triage, where Haiku reads the checkout; friction-fix.yml's hourly run triages, with cw friction triage-backlog, the reports no triage run labelled. Triage decides one of four: duplicate (a comment on the original, and the report closed), already-fixed (labelled wontfix and closed with where the fix lives), ready-for-human (an agent brief for a person), or ready-for-agent (an agent brief). Triage dispatches friction-fix.yml for a ready-for-agent report: Sonnet fixes it, the checks pass, and it becomes one commit on the chore/friction-autofix PR, with the report labelled fixed in it, for a person to approve the checks, review and merge. A report the fixer passed on, that failed a check or couldn't be pushed goes to ready-for-human." src="../../docs/diagrams/friction-lifecycle.light.svg">
</picture>

Every step that writes to GitHub is a `cw friction` command, so it's tested here and in `@repo/cli`, not shell in a workflow. The workflows only check out, install, pass tokens and run the commands.

| Step                              | Command                               | Module                    | Model      |
| --------------------------------- | ------------------------------------- | ------------------------- | ---------- |
| File a report, or add to one      | `cw friction report` (`search` first) | `reports.ts`              | none       |
| Triage one report                 | `cw friction triage <n>`              | `reports.ts`, `triage.ts` | Haiku 5.5  |
| Triage the ones no run labelled   | `cw friction triage-backlog`          | `reports.ts`, `triage.ts` | Haiku 5.5  |
| Rebase the bot's open PR onto dev | `cw friction refresh`                 | `refresh.ts`              | none       |
| Check out where the fix starts    | `cw friction start`                   | `push.ts`                 | none       |
| Fix a batch of reports            | `cw friction fix <n…>`                | `fix.ts`, `tools.ts`      | Sonnet 5.5 |
| Check and commit the fix          | `cw friction commit <n…>`             | `commit.ts`               | none       |
| Push, open the PR, relabel        | `cw friction publish <n…>`            | `publish.ts`, `push.ts`   | none       |
| Hand back a stopped run's reports | `cw friction hand-back <n…>`          | `publish.ts`              | none       |

Learn each command's options from `pnpm cw friction <command> --help`; every one that writes takes `--dry-run`.

## Modules

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../docs/diagrams/friction-bot-modules.dark.svg">
  <img alt="@repo/cli's cw friction commands call into @repo/friction-bot: triage.ts (Haiku, a read-only loop), fix.ts (the Sonnet tool loop), commit.ts (the commit gate), reports.ts (file, triage, gather), refresh.ts (rebase the open PR), publish.ts (PR, relabel, hand-back), push.ts (start and push the branch), and api-error.ts and api-key.ts. triage.ts and fix.ts both use cost.ts for their dollar caps and tools.ts for their tools; commit.ts and push.ts use tools.ts for its forbidden paths. reports.ts, refresh.ts and publish.ts reach GitHub through github.ts, the gh CLI." src="../../docs/diagrams/friction-bot-modules.light.svg">
</picture>

| Module         | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reports.ts`   | The rules around a report: its body from friction.md's sections (`reportBody`), searching (`searchReports`), triaging one (`triageReport`) and the backlog (`triageBacklog`), turning a decision into labels, comments and closes (`triageActions`), and gathering a batch for the fixer (`gatherReports`). Only comments from people with write access reach a model (`trustedComments`), and the fixer gets only the brief block of triage's own latest comment (`triageBrief`). `ReportError` is the coded refusal every module throws. |
| `triage.ts`    | Haiku's decision: the prompt, the `Triage` schema (`decision`, `duplicate_of`, `fixed_in`, `reason`, `brief`), and `triage()`, a short read-only tool loop that returns the answer with the list of what it `checked`.                                                                                                                                                                                                                                                                                                                     |
| `fix.ts`       | Sonnet's tool loop over a batch of `ready-for-agent` reports. It answers with `fixed`, `skipped` (with a reason) and up to 3 `friction` reports of its own. `withCacheBreakpoint` keeps one prompt-cache breakpoint on the latest message, so each step reads the conversation so far from the cache.                                                                                                                                                                                                                                      |
| `tools.ts`     | The tools. `readTools` (`read_file`, `list_files`, `search`) is triage's set; `fixTools` adds `write_file`, `edit_file`, `delete_file` and `run_check`. Also the paths only the user changes (`FORBIDDEN`), path checks (`repoPath`, `writablePath`) and `runCheck`, which runs `pnpm <check>` without the secrets.                                                                                                                                                                                                                        |
| `cost.ts`      | List prices (`SONNET_5_5`, `HAIKU_5_5`, with `haikuPrice` for Haiku's long-context rate) and `usageCost`, what one step cost from the tokens it reports. The AI SDK has no budget of its own; the loops stop on this.                                                                                                                                                                                                                                                                                                                      |
| `commit.ts`    | The commit gate (`commitFix`): stage what the fixer changed, drop new files no fixed report names, refuse forbidden paths and repeated Markdown lines, run `COMMIT_CHECKS`, and commit what passes as one commit, bundled for `publish`.                                                                                                                                                                                                                                                                                                   |
| `push.ts`      | The bot's branch: where a fix starts (`startFix`, `startingPoint`) and how it's pushed (`pushFix`). It never pushes over a branch whose PR is open or never opened; a closed or merged PR's branch is replaced from `dev`.                                                                                                                                                                                                                                                                                                                 |
| `refresh.ts`   | `refreshPullRequest`: has GitHub rebase the bot's open PR onto `dev` before a fix stacks on it, and asks a person to "Update branch" when GitHub won't.                                                                                                                                                                                                                                                                                                                                                                                    |
| `publish.ts`   | `publishFix`: file the fixer's friction, push the commit, open or update the PR, and relabel each report from what happened to it. `handBack`: for a run that stopped before `publish` could say. `parseAnswer` and `parseCommitOutcome` check what the `fix` job left behind.                                                                                                                                                                                                                                                             |
| `github.ts`    | The `GitHub` interface and `ghCli()`, its only real implementation: the `gh` CLI, with bodies sent through stdin. `GhError` carries `gh`'s exit and output.                                                                                                                                                                                                                                                                                                                                                                                |
| `api-error.ts` | `callingTheApi` turns the AI SDK's errors into coded refusals (`anthropic_api_error` with `retryable`, `no_api_key`).                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `api-key.ts`   | `modelFromKeyFile`: the fixer's key, read from a file and deleted before the loop starts, so the checks it runs can't read it from an environment.                                                                                                                                                                                                                                                                                                                                                                                         |

## Triage

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../docs/diagrams/friction-triage-loop.dark.svg">
  <img alt="cw friction triage calls triageReport in reports.ts, which views the report on GitHub and lists the open and closed reports, then calls decide with them. triage.ts prompts Haiku 5.5 with CLAUDE.md, friction.md and the reports. In a loop of up to 8 steps and about $0.10, Haiku calls read_file, list_files and search on the checkout and gets file text, paths and matches back. On the last step, or once the cap is spent, it has no tools, so it answers: decision, fixed_in, reason and brief. triage.ts returns the decision and what it checked, and reports.ts labels, comments or closes on GitHub through triageActions." src="../../docs/diagrams/friction-triage-loop.light.svg">
</picture>

Triage runs on every report, so its loop is short: at most `TRIAGE_MAX_STEPS` (8) steps and about `TRIAGE_MAX_COST_USD` ($0.10). It can read, list and search the checkout, which in the workflow is `dev`, but not write or run checks: `readTools` is all it's given. It reads to check the report's claim (is the fact still missing, or stated somewhere else?) and to find where a fix would land, which sharpens the brief.

Rather than cut the model off mid-loop with no answer, the last step, and every step once the dollar cap is spent, offers no tools (`toolChoice: "none"`), so the model has to answer. A model that still answers with a tool call stops at the step cap and the command fails, leaving the report for the next hourly backlog run.

| Decision          | What `triageActions` does                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| `ready-for-agent` | Label it, and comment with the reason, what was checked, and the agent brief.                                     |
| `ready-for-human` | The same, with the brief written for a person.                                                                    |
| `duplicate`       | Comment on the original ("Another occurrence"), then close this one. Without an open original: `ready-for-human`. |
| `already-fixed`   | Label it `wontfix` and close it, naming where the fix lives (`fixed_in`). Without a place: `ready-for-human`.     |

The decision's labels replace any triage label the report had (`--retriage`). Every triage comment starts with the AI disclaimer, ends with the footer `triageBrief` looks for, and lists what Haiku read and searched (`Checked: …`) so a person can see what the verdict rests on. A reason is folded onto one line so it can't pass for the brief block.

## The fix workflow

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../docs/diagrams/friction-fix-jobs.dark.svg">
  <img alt="friction-fix.yml's jobs in order: api-key checks the key is usable; triage-backlog runs cw friction triage-backlog with issues: write; prepare picks the ready-for-agent reports and runs cw friction refresh, with contents and pull-requests: write; fix, with a read-only token, runs cw friction start, fix and commit, and hands the bundle and answer to publish as an artifact; publish runs cw friction publish to push, open the PR and relabel; hand-back runs cw friction hand-back for the reports nobody labelled, also when fix stopped early." src="../../docs/diagrams/friction-fix-jobs.light.svg">
</picture>

The model's code never runs where a token can write. The `fix` job, where Sonnet edits files and runs `pnpm` checks, has a read-only GitHub token, gets the API key as a file (`api-key.ts`), and runs `cw` from a separate checkout of `dev` (`--checkout`), so a fix can't change the fixer's own code. It hands a git bundle and its answer to `publish`, whose token can push, and `publish` checks both again (`parseAnswer`, `parseCommitOutcome`, `FORBIDDEN`). The bot's PR waits for a person to approve its checks before CI runs anything the model wrote.

The boundaries, all enforced in code here:

- **Paths only the user changes**: `.claude/hooks/`, `.claude/settings*.json`, `.claude/skills/`, `.github/` and `.git/`, in any case (`FORBIDDEN`). The fixer's write tools refuse them, and `commitFix` and `pushFix` check the diff again.
- **New files**: committed only when a fixed report's summary names the path (`names`); any other new file is deleted before the checks run.
- **Checks**: `COMMIT_CHECKS` (`lint`, `format:check`, `check-types`, `test`, `test:integration`) must pass, and run without `ANTHROPIC_API_KEY`, `ANTHROPIC_API_KEY_FILE`, `GH_TOKEN` or `GITHUB_TOKEN` in their environment.
- **Spend**: the fixer stops at `--max-steps` (150) or about `--max-cost-usd` ($5), whichever comes first; triage at 8 steps or about $0.10.
- **Model input**: report text, comments and briefs are wrapped in tags the prompts call data, never instructions, and only trusted comments get there.

## Models and cost

Claude is called through the Vercel AI SDK (`ai`, `@ai-sdk/anthropic`) as plain Messages API requests, never Claude Code, which this repository's API credit doesn't cover. Both need `ANTHROPIC_API_KEY` (the fixer in CI: `ANTHROPIC_API_KEY_FILE`).

| Loop   | Model               | Tools       | Caps                 | Price per MTok (input / output)               |
| ------ | ------------------- | ----------- | -------------------- | --------------------------------------------- |
| Triage | `claude-haiku-5-5`  | `readTools` | 8 steps, about $0.10 | $0.10 / $0.50; $0.50 / $2.50 above 100K input |
| Fix    | `claude-sonnet-5-5` | `fixTools`  | 150 steps, about $5  | $2 / $10                                      |

Cache reads cost 0.1 times input and 5-minute cache writes 1.25 times. Each step's cost is counted from the tokens the API reports, so a cap is checked between steps: a run can go over it by at most one step.

## Testing

```sh
pnpm --filter @repo/friction-bot test
pnpm --filter @repo/friction-bot exec vitest run --project unit src/triage.test.ts
```

Unit tests only, all offline:

- **The model**: `scriptedModel` (`src/testing/mock-model.ts`) returns a scripted text or tool call per step, so tests drive the AI SDK's real tool loop and output parsing, and check what each step was sent (its tools, `toolChoice`, the prompt so far).
- **git**: `tempRepo` (`src/testing/git-repo.ts`) makes real repositories in a temp directory, a bare `origin` and a clone, with the user's git config kept out.
- **GitHub**: `memoryGitHub` (`src/testing/memory-github.ts`) answers the `GitHub` interface from issues and PRs in memory and records every write; `@repo/cli`'s tests use it too.
- **The network**: tests run under MSW (`src/testing/msw-setup.ts`), which fails any request no handler answers, so a test can drive the real Anthropic provider against a saved response (`api-error.test.ts`) but never reach the network.

The commands' wiring (options, output, codes, exit status) is tested in `@repo/cli`'s `friction.test.ts`; the rules are tested here.
