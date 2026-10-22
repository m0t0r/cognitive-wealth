# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Overview

pnpm + Turborepo monorepo, freshly scaffolded from `create-turbo` (no product code yet). Toolchain is pinned to recent majors: Node >=24, pnpm 12, TypeScript 7, Next.js 16, React 19, Oxlint + Oxfmt (no ESLint/Prettier). Don't assume older-version APIs or config formats.

## Commands

Run from the repo root (tasks fan out via Turborepo):

- `pnpm dev`: all apps (`web` on :3000)
- `pnpm build`, `pnpm check-types` (via Turborepo)
- `pnpm lint` / `pnpm lint:fix`: Oxlint over the whole repo, run once from the root (not a Turborepo task)
- `pnpm format` / `pnpm format:check`: Oxfmt over the whole repo (defaults, incl. 100-col print width and `package.json` key sorting)
- Single workspace: `pnpm exec turbo <task> --filter=<name>` (e.g. `--filter=web`, `--filter=@repo/ui`)

There is no test runner configured yet.

Lint config lives in the root `.oxlintrc.json`: `denyWarnings` makes warnings fail, `typeAware` runs type-aware rules through `oxlint-tsgolint` (version-locked to TypeScript 7), and the `nextjs` plugin is enabled only for `apps/web/**`. `eslint-plugin-turbo` is loaded as an Oxlint JS plugin, so env vars not declared in `turbo.json` are lint errors. `check-types` in the Next apps runs `next typegen` before `tsc --noEmit`.

## Architecture

- `apps/web`: Next.js App Router app (`app/` directory, CSS modules).
- `packages/ui` (`@repo/ui`): shared React components. **Not built.** `exports: { "./*": "./src/*.tsx" }` means consumers import raw source (`import { Button } from "@repo/ui/button"`), and Next compiles it. A new file in `src/` becomes importable by name automatically.
- `packages/typescript-config` (`@repo/typescript-config`): shared `base.json`, `nextjs.json`, `react-library.json`. TypeScript 7 requires an explicit `rootDir` whenever `outDir` is set.

Internal packages are linked with `workspace:*`. In `turbo.json`, `build` and `check-types` depend on the same task in dependencies (`^task`). The cached build outputs are `.next/**` (minus cache and dev), and `.env*` files are build inputs.
