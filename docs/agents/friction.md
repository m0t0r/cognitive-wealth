# Friction reports

Report every friction you hit while working in this repo as a GitHub issue with the `friction` label. These reports are how the repo's setup (docs, tooling, skills, config) gets better for the next agent, so report even small ones.

## What counts as friction

- **Blockers**: anything that stopped you and needed a workaround, a retry, or the user's help.
- **Slow resolution**: anything that took noticeably longer than it should have, such as a failing command, an unclear error, or a missing dependency.
- **Wrong or stale context**: instructions in `CLAUDE.md`, `AGENTS.md`, `docs/` (including the ADRs), or a skill that didn't match the repo (wrong commands, files that no longer exist).
- **Duplicated context**: the same information appearing in more than one place in your context (e.g. `CLAUDE.md` and a `docs/agents/` file, `CLAUDE.md` and an ADR, two skills, or a skill and a doc), whether or not the copies agree. Name every place it appears.
- **Missing context**: anything you had to find out by exploring that a doc should have told you up front.
- **Anything else** that made the work harder than it needed to be.

If you're unsure whether something counts, report it.

## How to report

1. Keep a running list as you work. Don't stop the task to file reports.
2. At the end of the task, before your final summary, look for an existing report: `pnpm cw friction search <keywords>` (`--closed` to include closed ones).
3. If one has the same cause, add your occurrence to it: `pnpm cw friction report --on <number> --what … --cost … --where …`.
4. Otherwise file one report per distinct friction, with this file's sections as options. `--dry-run` shows the body first:

   ```sh
   pnpm cw friction report --title "<short description>" --what "<observed vs. expected, exact error text if short>" --cost "<what it blocked or how long it took to resolve>" --where "<files, commands, docs, or skills involved>" --fix "<optional: what would have prevented it>"
   ```

   Keep the command on one line, and each section to one line. For multi-line text (a stack trace, a diff), write the whole body, with the `## What happened`, `## Cost`, `## Where` and `## Suggested fix` headings, to a file in `.dev/scratch/` and pass `--body-file <file>` instead of the sections. A heredoc or a multi-line quoted argument is refused by worktree isolation (CLAUDE.md, "Worktrees").

   Before writing a suggested fix, check it against `CLAUDE.md`'s hard rules (test isolation, worktrees, the auth ADRs) and against `origin/dev`: a fix that points a worktree at the shared dev database breaks isolation (#125), and one that adds a command may find it already exists, undocumented (#136).

5. List the issues you filed or commented on in your final summary.

## What happens to a report

Two workflows pick reports up, so filing one is enough:

- `.github/workflows/friction-triage.yml` runs `pnpm cw friction triage <number>` when the `friction` label lands. Haiku reads the report beside the open ones and labels it `ready-for-agent` (a fix in this repo's files that the checks can prove) or `ready-for-human` (hooks, settings or workflows; the environment an agent ran in; what `apps/web` renders; auth, security or a decision), or closes it as a duplicate with a comment on the original. Unless it's a duplicate, its comment carries an agent brief in the layout of the `triage` skill's `AGENT-BRIEF.md` (current and desired behaviour, key interfaces, acceptance criteria, out of scope), which the fixer, or a person, works from. `pnpm cw friction triage <number> --dry-run` shows what it would decide without changing the issue (`--retriage` for one already labelled); it needs `ANTHROPIC_API_KEY`.
- `.github/workflows/friction-fix.yml` looks every 3 hours and, once 3 reports are `ready-for-agent` or the oldest is 4 hours old, has Sonnet fix them (`pnpm cw friction fix <number> …`) in one commit on the `chore/friction-autofix` PR (adding to it while it's open). It never changes `.claude/hooks/`, `.claude/settings*.json` or `.github/`. A report it passes on, or whose fix fails the checks, goes to `ready-for-human` with the reason. What made the fixer's own work harder comes back in its answer, and the workflow files it as up to 3 new reports, labelled `ready-for-human` without triage: their text is the model's, so a person reads each one and relabels it `ready-for-agent` to have it fixed. Run it now from Actions → Friction fix → Run workflow.

Both run `cw`'s `friction` commands, whose Claude calls are `@repo/friction-bot`'s (`packages/friction-bot`): it calls Claude through the Vercel AI SDK with the `ANTHROPIC_API_KEY` secret. They make plain API calls on purpose: the key's promotional credit covers the API but not Claude Code, so the Claude GitHub Action and the Claude Agent SDK were refused with "Credit balance is too low". `friction-fix.yml` checks the key and its credit on every run, and on a PR that changes these workflows, the bot or `cw` it also dry-runs a triage of the newest open report.

## Fixing a report

A report's "Suggested fix" is the reporter's hypothesis, not a spec. Re-check it the same way before building it (the hard rules, `origin/dev`), as for an issue's brief (`docs/agents/issue-tracker.md`), and fix the cause the report describes when the suggestion turns out wrong (#139).
