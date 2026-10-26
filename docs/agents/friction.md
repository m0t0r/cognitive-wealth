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
2. At the end of the task, before your final summary, check for existing reports: `gh issue list --label friction --state open --search "<keywords>"`.
3. If a matching issue exists, add a comment with your new occurrence: `gh issue comment <number> --body "..."`.
4. Otherwise create one issue per distinct friction:

   ```sh
   gh issue create --label friction --title "<short description>" --body "$(cat <<'EOF'
   ## What happened
   <observed vs. expected, exact error text if short>

   ## Cost
   <what it blocked or how long it took to resolve>

   ## Where
   <files, commands, docs, or skills involved>

   ## Suggested fix
   <optional: what would have prevented it>
   EOF
   )"
   ```

   Before writing a suggested fix, check it against `CLAUDE.md`'s hard rules (test isolation, worktrees, the auth ADRs) and against `origin/dev`: a fix that points a worktree at the shared dev database breaks isolation (#125), and one that adds a command may find it already exists, undocumented (#136).

5. List the issues you filed or commented on in your final summary.

## What happens to a report

Two workflows pick reports up, so filing one is enough:

- `.github/workflows/friction-triage.yml` runs when the `friction` label lands. Haiku reads the report beside the open ones and labels it `ready-for-agent` (a fix in this repo's files that the checks can prove) or `ready-for-human` (hooks, settings or workflows; the environment an agent ran in; what `apps/web` renders; auth, security or a decision), or closes it as a duplicate with a comment on the original.
- `.github/workflows/friction-fix.yml` looks every 3 hours and, once 3 reports are `ready-for-agent` or the oldest is 4 hours old, has Sonnet fix them in one commit on the `chore/friction-autofix` PR (adding to it while it's open). It never changes `.claude/hooks/`, `.claude/settings*.json` or `.github/`. A report it passes on, or whose fix fails the checks, goes to `ready-for-human` with the reason. Run it now from Actions → Friction fix → Run workflow.

Both use the `ANTHROPIC_API_KEY` secret, which `friction-fix.yml` checks on every run and on any PR that changes these workflows.

## Fixing a report

A report's "Suggested fix" is the reporter's hypothesis, not a spec. Re-check it the same way before building it (the hard rules, `origin/dev`), as for an issue's brief (`docs/agents/issue-tracker.md`), and fix the cause the report describes when the suggestion turns out wrong (#139).
