# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Overview

pnpm + Turborepo monorepo, scaffolded from `create-turbo`. Toolchain is pinned to recent majors: Node >=24, pnpm 12, TypeScript 7, Next.js 16, React 19, Oxlint + Oxfmt (no ESLint/Prettier). Don't assume older-version APIs or config formats.

What the product is, its principles, the synthetic world it runs on and the phase plan: [docs/product.md](docs/product.md). Read it before planning a feature; each phase has a GitHub issue.

## Worktrees

Every task that changes the repo runs in its own git worktree, whether or not the user mentions one. The main checkout is the user's.

1. **Start**: call `EnterWorktree` with a short kebab-case name for the task before the first edit. It branches `worktree-<name>` from `origin/dev` (`worktree.baseRef: "fresh"`) under `.claude/worktrees/`. `.worktreeinclude` copies `apps/web/.env.local`, and the `prepare-worktree` hook runs `pnpm install`. If `node_modules` is still missing, run `pnpm install --frozen-lockfile`.
2. **Branch**: rename the branch to the repo's `<type>/<topic>` form (`git branch -m feat/billing`) before you push.
3. **Run**: `pnpm dev` serves the worktree at `https://<branch>.cognitive-wealth.localhost`. Compose and `.secrets/` stay in the main checkout and serve every worktree.
4. **Sync**: to pick up a newer `dev`, run `git fetch origin && git rebase origin/dev` in the worktree and resolve conflicts there. In the main checkout, only `git pull --ff-only` (or `git merge --ff-only origin/dev`) is allowed. Run it when `dev` has moved, since the hooks run from the main checkout's copy. A worktree session can't run it (isolation refuses `git -C <main checkout>`), so ask the user to type `! git -C <main checkout> pull --ff-only`.
5. **Finish**: commit, push and open the PR from the worktree, ready for review (never left as a draft). Remove it (`ExitWorktree` with `remove`, or `git worktree remove`) only once the PR is merged or the user says so.

`.claude/hooks/require-worktree.mjs` enforces this. It denies edits inside the main checkout, and commands there that commit, stage, switch branches or rewrite files in place. A denial is the cue to call `EnterWorktree`, not to work around it. Reads, `gh`, a fast-forward of the main checkout and Edit/Write of files outside the repo (memory, Claude Code's scratchpad) are unaffected. An in-place rewrite (`sed -i`, `perl -pi`) from the main checkout is denied whatever its target. When the user explicitly wants work done in the main checkout, they start Claude with `CLAUDE_MAIN_CHECKOUT=1`. Its tests are `.claude/hooks/require-worktree.test.ts` (workspace `@repo/agent-hooks`, run by `pnpm test`); a change to what it allows or denies adds a case there.

Changes to `.claude/hooks/` or `.claude/settings.json` alter the agent's own guardrails, and auto mode denies them as self-modification until the user approves. Ask before the first edit, and make hook edits one at a time, so a denial can't leave a half-applied change.

A task's scratch files (scripts, intermediate output, PR bodies) go in the worktree's `.dev/scratch/`, not Claude Code's scratchpad: `.dev/` is gitignored, the hook doesn't restrict it, and it goes when the worktree is removed. The main checkout's `.dev/` holds only shared state (`auth/` from `dev:sign-in`, and `verifier-web`'s `verify/`, `perf/` and `worktrees/`); everything per-task stays in the worktree's.

Claude Code's own worktree isolation (separate from that hook) refuses commands it can't parse for git use, with "names git in a form too complex to verify", even when they never run git: `for`/`while` loops, heredocs (including `python - <<'EOF'`), multi-line quoted arguments (`gh pr create --body "…"`), and anything containing a URL like `github.com/…` (it matches `git` inside `github`). It also refuses a shell variable or command substitution where an argument goes (`cat $D/file`, `-F id=$(gh api …)`, "a value computed at runtime"), a relative `cd` chained with another command (`cd ../.. && …`, "a location computed at runtime"), any command with an `eval` argument (`agent-browser eval "…"`, "runs a string through eval"), and writing a script and running it in the same command. The Bash tool also keeps the working directory between calls, so a `cd` leaks into later commands. In a worktree, run every command from the worktree root and reach into a package with `pnpm --filter <pkg>`, `uv run --project <dir>` or a spelled-out path rather than `cd`, edit files with Edit/Write, spell paths out instead of using variables, pass long text through a file in `.dev/scratch/` (`--body-file`), and put loops, heredocs, `eval` and URL-bearing commands in a `.dev/scratch/` script written with Write, then run `sh <file>` as a command of its own. Files in the shared git dir (the main checkout's `.git/`, e.g. `.git/info/`) have no worktree copy and can't be written from a worktree session; ask the user to change them.

## Commands

Run from the repo root (tasks fan out via Turborepo):

- `pnpm dev`: all apps through [portless](https://portless.sh) (`web` at `https://cognitive-wealth.localhost`; a linked git worktree gets `https://<branch>.cognitive-wealth.localhost`), so no app binds a fixed port. Each app's `dev` script is `portless` and the real command is `dev:app`, named in the package's `"portless"` key; add new apps the same way. `PORTLESS=0 pnpm dev` bypasses the proxy (Next's default :3000). The first run starts the proxy on 443 (sudo prompt, local CA); in a non-interactive shell run `portless proxy start` (or `portless service install`) once first. E2E doesn't use portless: it gives each worker its own free port
- `pnpm e2e`: builds `web`, then runs Playwright with Postgres, Redis and Mailpit containers and one standalone server per worker; needs Docker (`--filter=web-e2e --only` skips the build)
- `docker compose up --build`: Postgres 18 + migrations + Redis + Mailpit (UI on `http://127.0.0.1:8025`) + `web`. Create `.secrets/` first with the loop in `compose.yaml`'s header, which names every secret and skips the ones that exist. The custodian's own Postgres, `custodian-db`, is in `apps/custodian/README.md`. For `pnpm dev`, run `docker compose -f compose.yaml -f compose.dev.yaml up -d db migrate redis mailpit` (Postgres on `127.0.0.1:5432`, Redis on `:6379`, SMTP on `:1025`) and `cp apps/web/.env.example apps/web/.env.local`
- `pnpm --filter @repo/db db:generate`: drizzle-kit migration from `src/schema/`; `db:migrate` applies them (`DATABASE_URL`, optional `DATABASE_PASSWORD_FILE`)
- `pnpm db:seed` (`packages/households/src/cli/seed.ts`): idempotent dev users and Firms (`owner@`, `admin@`, `member@cognitive-wealth.test`; Larkspur Wealth Partners, the world file's Firm, and Globex), then `world/v0.json`'s CRM half into Larkspur, all in one transaction; refuses an invalid world file, `NODE_ENV=production` and non-local hosts
- `pnpm org:create --name <name> [--slug <slug>] --owner <email>`: the invite-only way to create an org, in any environment (production via `DATABASE_URL` + `DATABASE_PASSWORD_FILE`). Without `DATABASE_URL`, both CLIs read it from `apps/web/.env.local`
- `pnpm dev:sign-in <email> [--link] [--ip <addr>]`: signs a seeded or invited user in to `pnpm dev` through the real flow; saves `.dev/auth/<email>.json` for `agent-browser --state`. `--ip` sends that client IP as `x-forwarded-for`, so each session gets its own rate-limit bucket on a stack that trusts it (Compose)
- `pnpm --filter @repo/email dev`: email template previews at `https://emails.cognitive-wealth.localhost`
- `pnpm docs:diagrams`: renders `docs/diagrams/*.mmd` with Pele into `<name>.light.svg` and `<name>.dark.svg` (deterministic, so an unchanged source gives no diff). `pnpm docs:diagrams:preview [name ...]` also writes full-size 2x PNGs to `.dev/diagrams/` for the Read tool to show; it warns when a label's `<word>` will be dropped as HTML

## Architecture

The platform overview, with diagrams of the system, packages, request flow, data model and decisions, is [docs/architecture.md](docs/architecture.md). A change that alters something a diagram shows updates its `.mmd` and re-renders it in the same commit.

- `apps/custodian`: the simulated custodian, a Python FastAPI app run with uv ([ADR 0011](docs/adr/0011-custodian-simulator-in-python.md)). Its rules and a Python-for-TypeScript cheat sheet are in `apps/custodian/CLAUDE.md`.
- `packages/custodian-client` (`@repo/custodian-client`): Cognitive Wealth's only way to the custodian, imported as source by server code. Orval generates `src/generated/` from `apps/custodian/openapi.json` (`pnpm --filter @repo/custodian-client generate`): a `fetch` client whose requests go to `CUSTODIAN_URL` (required, no default) and whose responses are Zod-parsed, and a strict Zod schema per component, the Custodian feed's rows and Manifest included. The wire stays snake_case: each schema checks the snake_case keys and renames them to camelCase, so `PositionRow` (`zod.input`) is what arrives and `PositionRowOutput` (`zod.output`) is what our code uses. The generated files are excluded from Oxlint and Oxfmt and never hand-edited; `generated.test.ts` fails when they drift from `openapi.json`.
- `packages/design-system` (`@repo/design-system`): shadcn/ui (preset `bjbigatl2`: `base-luma` on Base UI, Hugeicons, Inter + Noto Sans headings) incl. the AI chat primitives (MessageScroller, Message, Bubble, Trace, Attachment, Marker, CodeBlock, Questionnaire). **Not built**: consumers import source (`@repo/design-system/components/button`, `/globals.css`, `/lib/utils`, `/hooks/*`) and Next transpiles it via `transpilePackages`. Run shadcn commands from `apps/web` (e.g. `pnpm dlx shadcn@latest add <name>`); its `components.json` routes components, hooks and lib into the package. Generated `components/` and `hooks/` are excluded from Oxlint; don't hand-edit them unless intended. An intended edit carries a comment saying what changed and why (e.g. `button.tsx`'s `aria-disabled:` styles), and updating a component goes through `add <name> --dry-run` / `--diff` and a merge, never `--overwrite`, which drops local edits.
- `packages/db` (`@repo/db`): Drizzle ORM over `postgres` (postgres.js), imported as source. Its conventions (import extensions, schema rules, database roles) are in `packages/db/CLAUDE.md`.
- `packages/households` (`@repo/households`): Households, People, Accounts and Account roles, framework-agnostic and imported as source ([ADR 0012](docs/adr/0012-domain-code-in-one-package-per-area.md)). Functions take the Firm's internal id as a parameter, never a session, and return DTOs with `publicId`s only. `./world` validates the world file (`world/schema.json` with Ajv, plus the cross-field rules `world.py` checks), `./seed` loads its CRM half, and the `db:seed` CLI lives here because `@repo/db` can't depend on it.
- `packages/auth` (`@repo/auth`): Better Auth server, imported as source and framework-agnostic (takes `Headers`, returns DTOs or typed `Result`s). Node can't load it directly (it imports `.tsx` templates).
- `packages/email` (`@repo/email`): React Email templates (`src/templates/`), `render*Email()` returning `{ subject, html, text }` (the plain text is a contract the sign-in harness parses), and `Mailer`s: SMTP (Mailpit in dev/e2e) or Resend, picked by `mailerFromEnv()`. `/testing` exports a memory mailer.
- `apps/web/Dockerfile`: all images are pinned `tag@digest`; Dependabot (`.github/dependabot.yml`) bumps them.
- `packages/testing` (`@repo/testing`): shared test tooling, imported as source. `/vitest` exports `defineVitestConfig()`, which every package's `vitest.config.ts` calls. `/react` re-exports React Testing Library plus `userEvent` and `setup()`, and registers jest-dom matchers and cleanup. `/pglite` provides `createDatabaseTest(migrate)`. `/mailpit` and `/sign-in` are the sign-in harness behind `pnpm dev:sign-in` and the e2e `signIn` fixture.
- `packages/typescript-config` (`@repo/typescript-config`): TypeScript 7 requires an explicit `rootDir` whenever `outDir` is set.

## Auth

Decisions and their reasons are in `docs/adr/` (0001 to 0008); how the system works today is in [docs/auth.md](docs/auth.md). Change the code and `docs/auth.md` in the same commit; reversing a decision means a new ADR that supersedes the old one.

- Internal IDs never reach the browser ([ADR 0003](docs/adr/0003-internal-bigint-ids-public-uuids.md)). Server Components and Server Actions take `publicId`s and return DTOs (`PublicUser`, `PublicOrganization`, …); `viewer.internal` stays on the server.
- The browser talks to Better Auth only through the allowlist in `createAuthRouteHandler`; everything else 404s. A new browser-facing endpoint changes [ADR 0004](docs/adr/0004-browser-reaches-better-auth-through-an-allowlist.md).
- On the server, authorize with `getViewer`/`requireTenant` from `@repo/auth` (adapted in `apps/web/lib/auth/`) and scope every query to the tenant they return ([ADR 0002](docs/adr/0002-tenant-is-the-sessions-active-organization.md): no RLS, so a missed filter leaks). `proxy.ts` only does an optimistic cookie check.
- Revoke sessions and delete or deactivate users through Better Auth (or `revokeUserSessions`), never raw SQL: sessions are cached in Redis, so SQL alone leaves people signed in for up to 7 days ([ADR 0005](docs/adr/0005-sessions-cached-in-redis.md), [docs/incident-response.md](docs/incident-response.md)).
- Dev and test sign-in run the real email flow through the harness ([docs/dev-sign-in.md](docs/dev-sign-in.md)); the app has no backdoor, test-only route or bypass flag ([ADR 0007](docs/adr/0007-no-auth-backdoor.md)).
- Sign-in emails are sent after the response, through Next's `after()` (`apps/web/lib/auth/server.ts`), so timing can't reveal who is a client. Hosting must support `after()` ([ADR 0006](docs/adr/0006-sign-in-email-sent-after-the-response.md)), or sign-in emails silently never send.

## Testing

Each behaviour has one owning layer: test it there, and give other layers at most one representative case.

| Level                                         | Owns                                                                                                                                                                                                                      | Shouldn't repeat                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Unit                                          | Pure logic with many edge cases: callback-path sanitizer, allowlist path matcher, Sec-Fetch and origin rules, env parsing, device-cookie parsing, DTO mappers                                                             | Anything needing Better Auth or a database                             |
| Integration (PGlite + real Better Auth)       | The main home for auth and security rules: replay and expiry, sibling cleanup, eligibility gate, throttle rules, roles and permissions, tenant scoping (incl. `tenant_changed`), fresh-session gating, audit rows, timing | Browser behaviour                                                      |
| UI (RTL + happy-dom)                          | Component state machines: sign-in steps, resend cooldown, the confirm page not calling verify before a click, dialog confirms, focus after a row goes, refresh on stale-page errors                                       | The full journey, or server rules                                      |
| E2E (real Chromium, Redis, Mailpit, Postgres) | Only what needs the real stack (cookie flags, security headers and CSP, the scanner simulation, axe, keyboard journeys, aria snapshots); one representative case per category already covered by integration tests        | The full permission matrix, every error variant, every rate-limit rule |

Vitest 5 with three projects per package, picked by filename:

- `*.test.ts`: unit tests in Node
- `*.test.tsx`: UI tests in happy-dom. Import from `@repo/testing/react`, query by role or label, and drive interactions with `user-event` (`const { user } = setup(<X />)`), not `fireEvent`.
- `*.integration.test.{ts,tsx}`: integration tests against real Postgres via PGlite. Use `const test = createDatabaseTest(migrate)` and take `db` from the test context; for Drizzle code, import `test` from `@repo/db/testing` and take `orm` (the real migrations, applied per worker, cloned per test). Add `// @vitest-environment happy-dom` to a file that also renders.
- E2E: `apps/web-e2e/tests/*.spec.ts`

Vitest globals are on (`globals: true` in `defineVitestConfig()`, `vitest/globals` in each package's tsconfig `types`): use `describe`/`it`/`expect`/`vi` without importing them. Library code in `@repo/testing` still imports from `vitest`.

**Test isolation is a hard requirement at every level.** No test may depend on another test's state or on execution order. No test or verification run touches the dev or production database, Redis or Mailpit: integration tests use PGlite (the custodian's, which are Python, a Testcontainers Postgres with a database per test), e2e uses Testcontainers, and runtime verification uses the in-memory `compose.verify.yaml` project with a fresh database per server (`verifier-web` skill).

- Unit/UI: mocks, env and globals are restored after each test in the shared config, and RTL cleans up the DOM.
- Integration: `createDatabaseTest` migrates a template DB once per worker and gives each test its own `clone()`. Never share a `db` across tests or write to module-level state.
- E2E: each worker gets its own database copy and server, and each test seeds its own data, never shared setup. The fixtures and seeding rules are in `apps/web-e2e/CLAUDE.md`.

## Accessibility

The bar is WCAG 2.2 AA, enforced at three levels:

- **Lint:** all Oxlint `jsx-a11y` rules are errors, except `control-has-associated-label`, which can't see labels passed through Base UI's `render` prop (axe covers it at runtime). `settings.jsx-a11y.components` maps `Button`/`Input`/`Label`/`Textarea` to native elements; extend that map when adding thin wrappers.
- **Component tests:** every design-system component test includes `await expect(container).toHaveNoA11yViolations()` (axe-core via `@repo/testing/react`). Colour contrast and landmarks are skipped (happy-dom has no layout). With a popup open (menu, select, popover), scan the popup element, not `document.body`: without layout axe can't tell the popup is modal and flags Base UI's `aria-hidden` focus guards (`aria-hidden-focus`), which a real browser doesn't.
- **E2E:** `tests/a11y.spec.ts` runs an axe scan of every route in `PUBLIC_ROUTES` and `SIGNED_IN_ROUTES` (`support/routes.ts`) in light and dark themes, and fails on any violation. Add new routes there; `security-headers.spec.ts` covers the same list. Use `makeAxeBuilder` from `fixtures.ts` to scan interactive states (open dialogs, menus), cover keyboard journeys (focus moves in, Escape closes, focus returns) in `keyboard.spec.ts`, and keep `aria-snapshot.spec.ts` in sync (`--update-snapshots`, then review the YAML diff).

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `m0t0r/cognitive-wealth`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `GLOSSARY.md` plus `docs/adr/`. See `docs/agents/domain.md`.

### Web research

When WebFetch can't open a page you need to cite (a 403, "Access Denied", an unreadable PDF), follow `docs/agents/web-research.md`: a headed agent-browser usually gets through, and a search summary is never the source.

### Verification

Verify every change that reaches `apps/web` in the running app before reporting it done: invoke the `verifier-web` skill (host production build, agent-browser, chrome-devtools perf trace) and give its verdict and evidence in your summary. Passing tests aren't that evidence.

### Friction reports

Report every friction you hit (blockers, slow fixes, stale, missing or duplicated context) as a GitHub issue labelled `friction`, filed at the end of the task. See `docs/agents/friction.md`.
