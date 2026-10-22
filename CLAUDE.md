# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Overview

pnpm + Turborepo monorepo, scaffolded from `create-turbo` (no product code yet). Toolchain is pinned to recent majors: Node >=24, pnpm 12, TypeScript 7, Next.js 16, React 19, Oxlint + Oxfmt (no ESLint/Prettier). Don't assume older-version APIs or config formats.

## Commands

Run from the repo root (tasks fan out via Turborepo):

- `pnpm dev`: all apps (`web` on :3000)
- `pnpm build`, `pnpm check-types` (via Turborepo)
- `pnpm lint` / `pnpm lint:fix`: Oxlint over the whole repo, run once from the root (not a Turborepo task)
- `pnpm format` / `pnpm format:check`: Oxfmt over the whole repo (defaults, incl. 100-col print width and `package.json` key sorting)
- `pnpm test` (unit + UI), `pnpm test:integration`, `pnpm test:coverage` (all three, per-package reports in `coverage/`), `pnpm test:watch`
- `pnpm e2e`: builds `web`, then runs Playwright with a Postgres container and one standalone server per worker; needs Docker (`--filter=web-e2e --only` skips the build)
- `docker compose up --build`: Postgres 18 + migrations + `web` (create `.secrets/` first, see `compose.yaml`). Add `-f compose.yaml -f compose.dev.yaml up -d db migrate` to expose Postgres on `127.0.0.1:5432` for `pnpm dev`
- `pnpm --filter @repo/db db:generate`: drizzle-kit migration from `src/schema/`; `db:migrate` applies them (`DATABASE_URL`, optional `DATABASE_PASSWORD_FILE`)
- Single workspace: `pnpm exec turbo <task> --filter=<name>` (e.g. `--filter=web`); single file: `pnpm --filter <name> exec vitest run <path>`

Lint config lives in the root `.oxlintrc.json`: `denyWarnings` makes warnings fail, `typeAware` runs type-aware rules through `oxlint-tsgolint` (version-locked to TypeScript 7), and the `nextjs` plugin is enabled only for `apps/web/**`. `eslint-plugin-turbo` is loaded as an Oxlint JS plugin, so env vars not declared in `turbo.json` are lint errors. `check-types` in the Next apps runs `next typegen` before `tsc --noEmit`.

## Architecture

- `apps/web`: Next.js App Router app (`app/` directory, CSS modules).
- `packages/design-system` (`@repo/design-system`): shadcn/ui (preset `bjbigatl2`: `base-luma` on Base UI, Hugeicons, Inter + Noto Sans headings) incl. the AI chat primitives (MessageScroller, Message, Bubble, Trace, Attachment, Marker, CodeBlock, Questionnaire). **Not built**: consumers import source (`@repo/design-system/components/button`, `/globals.css`, `/lib/utils`, `/hooks/*`) and Next transpiles it via `transpilePackages`. Run shadcn commands from `apps/web` (e.g. `pnpm dlx shadcn@latest add <name>`); its `components.json` routes components, hooks and lib into the package. Generated `components/` and `hooks/` are excluded from Oxlint; don't hand-edit them unless intended.
- `packages/db` (`@repo/db`): Drizzle ORM over `postgres` (postgres.js), imported as source. `.` exports the `Database` type and `ping()`, `/client` `getDb()` (lazy, `server-only`), `/connect` `connect()`, `/migrator` `runMigrations()`, `/schema/*` the tables, and `/testing` a PGlite-backed `test`. Files Node runs directly (`migrate.ts` and what it imports) keep `.ts` import extensions; files the app bundles don't. Follow the `drizzle` skill: tables in `src/schema/` (one file per family, `_helpers.ts` timestamps), no serial/composite PKs, `db.select()` builders only (no `db.query`). Migrations live in `migrations/` and run as the `migrator` role; the app connects as `app` (DML only), both created by `docker/initdb/01-roles.sh`.
- `apps/web/Dockerfile`: `turbo prune` → pnpm install (store cache mount) → Next standalone build, with `web` and `migrate` targets on distroless non-root. All images are pinned `tag@digest`; Dependabot (`.github/dependabot.yml`) bumps them.
- `packages/testing` (`@repo/testing`): shared test tooling, imported as source. `/vitest` exports `defineVitestConfig()`, which every package's `vitest.config.ts` calls. `/react` re-exports React Testing Library plus `userEvent` and `setup()`, and registers jest-dom matchers and cleanup. `/pglite` provides `createDatabaseTest(migrate)`.
- `apps/web-e2e`: Playwright suite for `web` (it depends on `web` so `^build` builds it first).
- `packages/typescript-config` (`@repo/typescript-config`): shared `base.json`, `nextjs.json`, `react-library.json`. TypeScript 7 requires an explicit `rootDir` whenever `outDir` is set.

Internal packages are linked with `workspace:*`. In `turbo.json`, `build` and `check-types` depend on the same task in dependencies (`^task`). The cached build outputs are `.next/**` (minus cache and dev), and `.env*` files are build inputs.

## Testing

Vitest 5 with three projects per package, picked by filename:

- `*.test.ts`: unit tests in Node
- `*.test.tsx`: UI tests in jsdom. Import from `@repo/testing/react`, query by role or label, and drive interactions with `user-event` (`const { user } = setup(<X />)`), not `fireEvent`.
- `*.integration.test.{ts,tsx}`: integration tests against real Postgres via PGlite. Use `const test = createDatabaseTest(migrate)` and take `db` from the test context; for Drizzle code, import `test` from `@repo/db/testing` and take `orm` (the real migrations, applied per worker, cloned per test). Add `// @vitest-environment jsdom` to a file that also renders.
- E2E: `apps/web-e2e/tests/*.spec.ts`

Vitest globals are off, so import `describe`/`it`/`expect`/`vi` from `vitest`.

**Test isolation is a hard requirement at every level.** No test may depend on another test's state or on execution order.

- Unit/UI: mocks, env and globals are restored after each test in the shared config, and RTL cleans up the DOM.
- Integration: `createDatabaseTest` migrates a template DB once per worker and gives each test its own `clone()`. Never share a `db` across tests or write to module-level state.
- E2E: each run starts a throwaway Postgres (Testcontainers, the image pinned in `compose.yaml`; needs Docker) and migrates a template DB. Each Playwright worker gets its own `CREATE DATABASE … TEMPLATE` copy and its own standalone server, which `baseURL` points at. The auto `db` fixture (Drizzle) truncates every table before each test: seed per test through it, never in shared setup. Specs must import `test`/`expect` from `fixtures.ts` (lint-enforced). When auth lands, give each worker a unique user and `storageState`.

## Accessibility

The bar is WCAG 2.2 AA, enforced at three levels:

- **Lint:** all Oxlint `jsx-a11y` rules are errors, except `control-has-associated-label`, which can't see labels passed through Base UI's `render` prop (axe covers it at runtime). `settings.jsx-a11y.components` maps `Button`/`Input`/`Label`/`Textarea` to native elements; extend that map when adding thin wrappers.
- **Component tests:** every design-system component test includes `await expect(container).toHaveNoA11yViolations()` (axe-core via `@repo/testing/react`). Colour contrast and landmarks are skipped in jsdom.
- **E2E:** `tests/a11y.spec.ts` runs an axe scan of every route in `ROUTES` in light and dark themes, and fails on any violation. Add new routes there. Use `makeAxeBuilder` from `fixtures.ts` to scan interactive states (open dialogs, menus), cover keyboard journeys (focus moves in, Escape closes, focus returns) in `keyboard.spec.ts`, and keep `aria-snapshot.spec.ts` in sync (`--update-snapshots`, then review the YAML diff).
