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

5. List the issues you filed or commented on in your final summary.
