# ADR 0011: The custodian simulator is written in Python

- Status: accepted
- Date: 2026-10-23

The simulated custodian ([ADR 0009](0009-custodian-is-the-book-of-record.md)) is a Python service in `apps/custodian`, on FastAPI, while everything else in the repo is TypeScript. Its toolchain is uv, ruff (lint and format), pyright in strict mode, pytest, Pydantic v2, and SQLAlchemy 2 with Alembic migrations against its own Postgres database. Its database tests run against Testcontainers, since PGlite is JavaScript-only.

## Why

- Learning FastAPI is one of the project's goals, and it is a common pairing in AI and fintech teams.
- A second language enforces the boundary ADR 0009 asks for: Cognitive Wealth can't import the custodian's code or types, so it can only use the published contract. FastAPI generates that contract as OpenAPI, and Cognitive Wealth generates its client from it with Orval: a `fetch` client plus Zod schemas, so every response and Custodian feed row is validated at runtime, not trusted.
- Generating the synthetic world is data work (survey sampling, factor-driven prices), which Python's ecosystem does best, and `Decimal` is in its standard library.

## Considered options

- **TypeScript with Hono.** One toolchain, but the boundary would rest on lint rules, and it teaches nothing new.
- **Turborepo's native uv workspaces.** These are behind an experimental flag that "can change at any time". `apps/custodian` instead has a `package.json` whose scripts call `uv run`, which is Turborepo's stable multi-language pattern. Revisit when the flag stabilises.

## Consequences

- Two toolchains: Oxlint and Oxfmt don't cover Python, so `lint`, `format` and `check-types` reach it through its package scripts. The worktree hook also runs `uv sync`.
- A second Dockerfile, pinned by digest like the others, with Dependabot watching its dependencies.
- The custodian's `openapi.json` is committed, with the Custodian feed's row formats as components, so the TypeScript side builds without Python running and a contract change shows up as a diff. The generated client skips Orval's React Query hooks: only Cognitive Wealth's server talks to the custodian.
- Agents write Python the owner is still learning to review, so `apps/custodian` keeps a short conventions file.
