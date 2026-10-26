# Architecture

The one-page view of the platform: what runs, how the code is split, how a request flows, and which decisions shape it. Each section is a diagram with a short caption and a link to the document that owns the detail. When this page and the linked document disagree, the linked document wins; fix this page.

Today the platform is the foundation for the product: passwordless, invite-only sign-in, multi-tenant organizations with roles, an audit log, and the tooling to build on them safely. The first domain tables, Households and their People, Accounts and Account roles, are seeded from the world file, and `pnpm custodian:ingest <date>` loads a day of the Custodian feed into them: Securities, Transactions, the Custodian's Positions and prices. `/households` lists the Firm's Households (from the sidebar), and the Household overview (`/households/[publicId]`) shows one Household's People, Accounts and Positions. What the product will be, the synthetic world it runs on and the phases it is built in are in [product.md](product.md); its vocabulary is in [GLOSSARY.md](../GLOSSARY.md). A Firm is an `organization`.

## System context

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="diagrams/system-context.dark.svg">
  <img alt="A person's browser talks HTTPS to the web app. Inside one Next.js process, proxy.ts routes pages to Server Components and Server Actions, and fetches to a four-route /api/auth allowlist. Both call @repo/auth, which uses Postgres as the app role, Redis for the session cache and rate limits, and an SMTP or Resend mailer after the response. A migrate job applies migrations as the migrator role, and an operator creates organizations with pnpm org:create." src="diagrams/system-context.light.svg">
</picture>

- **One deployable**: `web`, a Next.js standalone server. It must be a host that keeps `after()` work alive, or sign-in emails never send ([ADR 0006](adr/0006-sign-in-email-sent-after-the-response.md)).
- **Postgres is the source of truth**. The app connects as `app` (DML only); migrations run as `migrator` in their own job.
- **Redis holds only what we can lose**: the session cache and rate-limit counters ([ADR 0005](adr/0005-sessions-cached-in-redis.md)).
- **The browser reaches Better Auth through four routes**. Everything else goes through Server Components and Server Actions ([ADR 0004](adr/0004-browser-reaches-better-auth-through-an-allowlist.md)).
- **Organizations are created by an operator**, never by users ([ADR 0001](adr/0001-better-auth-passwordless-invite-only.md)).

## Workspace packages

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="diagrams/packages.dark.svg">
  <img alt="Runtime dependencies: web depends on @repo/auth, @repo/design-system, @repo/db and @repo/households; @repo/auth depends on @repo/db and @repo/email; @repo/households depends on @repo/db; @repo/portfolio depends on @repo/db and on @repo/custodian-client for the feed's rows and Manifest, and @repo/db on @repo/custodian-client for the Custodian's Registration types. Dev-only, dashed: web-e2e uses @repo/auth, @repo/db, @repo/email, @repo/testing, @repo/households and @repo/portfolio, and web's pnpm dev runs @repo/dev-env, which uses @repo/db and @repo/testing. custodian, a Python FastAPI app, has no workspace dependencies; @repo/custodian-client is generated, dashed, from its openapi.json." src="diagrams/packages.light.svg">
</picture>

Solid arrows are runtime dependencies and dashed ones are dev-only. Every workspace also has `@repo/testing` and `@repo/typescript-config` as dev dependencies, left out of the diagram. So is `@repo/agent-hooks` (`.claude/hooks`), a workspace only so that `pnpm test` runs the agent hooks' tests, and `@repo/lint-rules`, the Oxlint plugin that the root `.oxlintrc.json` loads. Packages aren't built: consumers import their TypeScript source, and Next transpiles it. What each package exports is in [CLAUDE.md](../CLAUDE.md#architecture).

`custodian` (`apps/custodian`) is the simulated custodian, in Python on FastAPI ([ADR 0011](adr/0011-custodian-simulator-in-python.md)). It shares no code with the TypeScript packages: Turborepo reaches it through a `package.json` whose scripts call `uv run`, so the root `lint`, `format`, `check-types`, `test`, `test:integration` and `dev` include it. For now it serves only `GET /health`, and its API docs at `/docs`. Its contract is the committed `apps/custodian/openapi.json`, with the Custodian feed's rows and Manifest as components; `@repo/custodian-client` (`packages/custodian-client`) is generated from it by Orval, a `fetch` client and Zod schemas that Cognitive Wealth's server code imports as source, so nothing crosses the boundary unvalidated. Its ledger (Securities and their daily prices, Accounts and append-only Transactions, in SQLAlchemy with Alembic migrations, and the Positions it rebuilds from them by Trade date) is in a Postgres server of its own, Compose's `custodian-db`, on a network none of Cognitive Wealth's services join, which `docker compose up` migrates (`custodian-migrate`) before it starts the `custodian` service on `http://127.0.0.1:8000`; `pnpm --filter custodian world:load` fills it from the custodian half of the world file (`world/v0.json`, validated by the committed `world/schema.json`) and a hand-written ledger fixture, and `pnpm --filter custodian feed:write --date <day>` writes that day's Delivery of the Custodian feed ([ADR 0017](adr/0017-custodian-feed-format.md)). Its market data is the Factor file, downloaded once per machine from the archived copy its committed Pin names and checked by SHA-256, and the committed Treasury yields; the API and `world:load` refuse to run without the pinned file, or on a database whose `build_record` names other inputs ([ADR 0019](adr/0019-market-data-pinned-or-committed.md)). Its conventions and a Python-for-TypeScript cheat sheet are in [apps/custodian/CLAUDE.md](../apps/custodian/CLAUDE.md).

## A signed-in request

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="diagrams/request-lifecycle.dark.svg">
  <img alt="Sequence: the browser requests a page; proxy.ts redirects to sign-in when there is no session cookie, otherwise renders with a CSP nonce. The page calls getViewer, which reads the session from Redis, falling back to Postgres, then reads memberships from Postgres and returns a Viewer. The page calls requireTenant and tenant-scoped reads filtered by organization_id, and gets DTOs with public IDs. A domain page such as Households also reads inside withFirm, which sets the tenant as the transaction's Firm and queries filtered by firm_id under row-level security. The page returns HTML with no internal IDs." src="diagrams/request-lifecycle.light.svg">
</picture>

`proxy.ts` only checks that a cookie exists; layouts, pages and actions verify the session. The tenant is the session's active organization, not a URL segment, and every query filters by it ([ADR 0002](adr/0002-tenant-is-the-sessions-active-organization.md)). Domain reads also run inside `withFirm`, which sets the transaction's Firm for Postgres row-level security on every Firm-scoped table ([ADR 0020](adr/0020-firm-isolation-by-row-level-security.md)). Internal IDs stay on the server ([ADR 0003](adr/0003-internal-bigint-ids-public-uuids.md)). Mutations add more checks: see [Tenant mutations](auth.md#tenant-and-session-api-server-only).

## Data model

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="diagrams/data-model.dark.svg">
  <img alt="Entity relationships: a user has sessions, accounts and memberships; an organization has members and invitations; a session points at its active organization; invitations record their inviter; audit events reference an actor user and an organization. An organization (the Firm) has households, persons and custodial accounts through firm_id; household_member links a person to a household with their role, and account_role links a person to a custodial account, each only within one Firm. Each ingested custodian_delivery carries its custodial_transaction, custodial_position and security_price rows, which point at the Firm's custodial accounts and securities. Verification rows stand alone. Tables people see carry a uuid public_id besides the bigint id." src="diagrams/data-model.light.svg">
</picture>

The diagram shows keys and the columns that carry rules, not every column: the schema is `packages/db/src/schema/`, and the rules it doesn't state are in [docs/auth.md](auth.md#data-model-rules). `audit_event` is append-only for the `app` role. The Household tables (`household`, `person`, `household_member`, `custodial_account`, `account_role`) each carry their Firm in `firm_id`, and each link between them is a foreign key on `(firm_id, id)`, so a row can only point at its own Firm's rows. Every table with a `firm_id` also has row-level security: `app` sees and writes only the rows of the Firm `withFirm` set for the transaction, and gets `Firm not set` without one; queries still filter by Firm too ([ADR 0020](adr/0020-firm-isolation-by-row-level-security.md)). `custodial_account` isn't `account` because Better Auth owns that name. `world_seed` records which world file `pnpm db:seed` last loaded into a Firm, so a rerun can tell a changed file from edits made in the app. `@repo/households` (`packages/households`) reads them: `listHouseholds(db, firmId)` returns `PublicHousehold` DTOs with `publicId`s only, and `getHouseholdOverview(db, { firmId, publicId })` the `HouseholdOverview` the Household page renders: its People (each with their Named-on Accounts, the ones they're only named on in another Household, kept out of `accounts` so nothing counts them), the Accounts they own or jointly own by that date (each once, with every Account role on it, and only the account number's last four characters), and their Positions on the Firm's latest As-of date, or null for another Firm's Household ([research](research/household-accounts.md)).

The Custodian feed's tables (`custodian_delivery`, `security`, `custodial_transaction`, `custodial_position`, `security_price`, in `schema/custodian-feed.ts`) are Firm-scoped the same way. `@repo/portfolio` (`packages/portfolio`) writes them: `ingestDelivery(db, { firmId, asOf, source })` reads one Delivery through a `FeedSource` (the custodian's local feed folder for now), checks it against its Manifest and every row against the contract's Zod schemas, refuses an account number the Firm has no Account for, and writes it in one database transaction with a `custodian_delivery` row holding the Manifest's Content hash, or writes nothing. The same hash again is `already_ingested`; a different one for that date is a Restatement, refused until phase 2. `accounts.csv` fills in the seeded `custodial_account` rows' `registration_type` and `opened_on`. Those two columns, and a `security` row's `name` and `kind`, keep only the latest Delivery's values: a change overwrites the old one, with no history yet (#126). Every row a Delivery writes has the same `arrived_at`, beside its Trade, Settlement and Posting dates ([ADR 0009](adr/0009-custodian-is-the-book-of-record.md)), and `transaction_id` is unique per Firm, a second guard against loading a Transaction twice. [The feed primer](learn/03-custodian-feed-and-ingestion.md) explains why.

## Environments

Every environment that serves the app runs the production build with `NODE_ENV=production`, except `pnpm dev`. They differ by explicit settings, never by an environment name ([ADR 0008](adr/0008-production-mode-everywhere.md)).

| Environment                                        | App                                                                                                                               | Postgres, Redis, Mail                                | Isolation                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------- |
| `pnpm dev`                                         | `next dev` through portless, `https://cognitive-wealth.localhost` (a worktree gets `https://<branch>.cognitive-wealth.localhost`) | Compose services from the main checkout, on loopback | one shared dev database                                    |
| `docker compose up`                                | the `web` image, `http://localhost:3000`, and the `custodian` image, `http://127.0.0.1:8000`                                      | Compose, on internal networks                        | one stack                                                  |
| Verification (`verifier-web`)                      | host production build, a port pair per checkout (after and before; the main checkout's is `:3100` and `:3101`)                    | `compose.verify.yaml`, in memory                     | a fresh database per server, named per worktree            |
| Image verification (`verifier-web`'s `compose.sh`) | compose.yaml's images, on host ports offset from the checkout's pair (the main checkout's web is `:4100`)                         | Compose, on internal networks                        | a Compose project and volumes per checkout                 |
| `pnpm e2e`                                         | one standalone server per Playwright worker                                                                                       | Testcontainers                                       | a database per worker, tables truncated per test           |
| `pnpm test`, `test:integration`                    | none                                                                                                                              | Testcontainers, one Postgres for the root run        | a template-copied database per test, per-package templates |

How to start each one is in [CLAUDE.md](../CLAUDE.md#commands) and [docs/dev-sign-in.md](dev-sign-in.md).

## Build and delivery

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="diagrams/image-build.dark.svg">
  <img alt="Two Dockerfiles. The web one: base, then turbo prune, then pnpm install with a store cache. The build stage runs next build for the web target; the db-deploy stage deploys @repo/db for the migrate target. Both targets are distroless Node 24, non-root. The custodian one: a Python 3.15 slim stage and uv's binary feed a build stage that runs uv sync with the locked runtime dependencies and compiles bytecode; the custodian image is Python 3.15 slim, non-root, and runs Uvicorn, or Alembic for custodian-migrate. Dependabot bumps the pinned image digests of both." src="diagrams/image-build.light.svg">
</picture>

`apps/web/Dockerfile` builds the `web` and `migrate` images, and `apps/custodian/Dockerfile` one image that Compose runs as `custodian` (Uvicorn) and `custodian-migrate` (Alembic, then exits). Every base image is pinned by `tag@digest`. The custodian's runtime is Debian slim, not distroless: Google's distroless Python ships Debian's Python, older than the 3.15 the custodian pins. Turborepo runs `build` and `check-types` after the same task in dependencies. There's no CI workflow and no deployment target yet: see [Open before the domain lands](#open-before-the-domain-lands).

## Decisions

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="diagrams/decisions.dark.svg">
  <img alt="How the ADRs relate: 0001 (Better Auth, passwordless, invite-only) leads to 0003 through its ID defaults, to 0004 through its HTTP surface, to 0005 because we own sessions, and to 0006 to avoid enumeration. 0003 feeds 0004. 0005 leads to the incident-response runbook, 0006 to the hosting requirement, 0002 to 0020, which supersedes its no-RLS rule, 0007 to the dev sign-in harness, and 0008 to 0007 because e2e runs production guards. 0009 leads to 0015, Positions counted by trade date, because they are rebuilt and reconciled. 0013 (round once) and 0015 (Settled cash by settlement date) lead to 0016, Settled cash and Market value rules. 0003 (id stays inside), 0015 (Positions as known that day) and 0016 (line values, no total) lead to 0017, the Custodian feed format and Transaction IDs. 0011 (Testcontainers, like the custodian's tests) leads to 0018, integration tests on real Postgres, which leads to 0020, row-level security per Firm, through real app logins. 0013 (exact Rates, no floats) and 0017 (same inputs, same Deliveries) lead to 0019, market data pinned or committed. 0020 (Firm deletion no longer cascades) and 0004 (server code still could delete) lead to 0021, records can't be deleted." src="diagrams/decisions.light.svg">
</picture>

| ADR                                                                  | Decision                                                                                                 |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [0001](adr/0001-better-auth-passwordless-invite-only.md)             | Better Auth in our own app and database; sign-in by an emailed link and code; sign-up by invitation only |
| [0002](adr/0002-tenant-is-the-sessions-active-organization.md)       | The tenant is the session's active organization; its no-RLS rule superseded by 0020                      |
| [0003](adr/0003-internal-bigint-ids-public-uuids.md)                 | bigint primary keys inside, UUIDv7 `public_id` outside                                                   |
| [0004](adr/0004-browser-reaches-better-auth-through-an-allowlist.md) | Four Better Auth routes reach the browser, rebuilt and with replaced bodies                              |
| [0005](adr/0005-sessions-cached-in-redis.md)                         | Sessions in Postgres, cached in Redis; revoke only through Better Auth                                   |
| [0006](adr/0006-sign-in-email-sent-after-the-response.md)            | Sign-in email work runs after the response, so timing reveals nothing                                    |
| [0007](adr/0007-no-auth-backdoor.md)                                 | No test-only sign-in; dev and tests use the real email flow                                              |
| [0008](adr/0008-production-mode-everywhere.md)                       | Production mode everywhere; environments differ by explicit settings                                     |
| [0009](adr/0009-custodian-is-the-book-of-record.md)                  | The Custodian is the book of record for holdings, simulated as a separate service                        |
| [0010](adr/0010-cognitive-ai-states-only-computed-facts.md)          | Cognitive AI states only Computed facts, cited to the calculation that produced them                     |
| [0011](adr/0011-custodian-simulator-in-python.md)                    | The custodian simulator is Python and FastAPI; Cognitive Wealth uses its OpenAPI through Orval           |
| [0012](adr/0012-domain-code-in-one-package-per-area.md)              | Domain code lives in one framework-agnostic package per area                                             |
| [0013](adr/0013-money-shares-prices-and-rates-are-separate-types.md) | Money is whole cents; shares, prices and rates are separate types; no floats; round once                 |
| [0014](adr/0014-cognitive-ai-on-the-ai-sdk-starting-small.md)        | Cognitive AI runs on the AI SDK and starts on the smallest model                                         |
| [0015](adr/0015-positions-counted-by-trade-date.md)                  | Positions count from the Trade date; the Settlement date never changes one                               |
| [0016](adr/0016-settled-cash-and-market-value-rules.md)              | Settled cash counts money in from its Settlement date; unpriced Securities have no Market value          |
| [0017](adr/0017-custodian-feed-format.md)                            | The Custodian feed's format; Transaction IDs set by whoever records a row, so a rebuild matches          |
| [0018](adr/0018-integration-tests-on-real-postgres.md)               | TypeScript integration tests run on a real Postgres, one server for the root run; PGlite is gone         |
| [0019](adr/0019-market-data-pinned-or-committed.md)                  | The Factor file is pinned to an archived copy and cached by hash; yields committed; builds recorded      |
| [0020](adr/0020-firm-isolation-by-row-level-security.md)             | Row-level security on every Firm-scoped table, keyed to a per-transaction Firm the domain functions set  |
| [0021](adr/0021-firm-and-delivery-records-cant-be-deleted.md)        | A Firm or Delivery with records can't be deleted; Better Auth refuses, and the foreign keys restrict     |

How sign-in, sessions and tenancy work today, with their own diagrams, is in [docs/auth.md](auth.md).

## How work gets done

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="diagrams/agent-sdlc.dark.svg">
  <img alt="Agent workflow: a task enters a git worktree branched from origin/dev, which a hook enforces. Code, docs and tests change, with pnpm dev on the worktree's own database and Redis prefix, then lint, format, type checks and tests run. A change that reaches apps/web is verified in a running production build. The pull request is written with pr-visual, friction is filed as issues, and the PR is reviewed and merged into dev. Then the worktree is removed, and pnpm dev:prune tears down the dev environment of every removed worktree; a second hook runs it after a removal and at every session's start and end." src="diagrams/agent-sdlc.light.svg">
</picture>

Coding agents follow this loop, defined in [CLAUDE.md](../CLAUDE.md#worktrees). Each step is a skill or a hook, so it doesn't depend on anyone remembering it. Pull requests target `dev`.

## Open before the domain lands

What the decisions so far leave open, each with where it was deferred:

- **"Workspace" in the UI.** Screens call an organization a workspace; the glossary calls it a Firm. Phase 1 renames the copy.
- **The second service in a worktree.** The custodian simulator ([ADR 0011](adr/0011-custodian-simulator-in-python.md)) has its image, Compose services and Turborepo tasks, but a git worktree's `pnpm dev` gives only Cognitive Wealth a database of its own: the custodian's dev database is still the main checkout's.
- **CI.** Lint, types, tests and e2e run only locally. Only Dependabot runs on GitHub.
- **Hosting.** The host must keep `after()` work alive and give a 10 to 30 second stop grace period ([ADR 0006](adr/0006-sign-in-email-sent-after-the-response.md)).
- **Environment label.** The first multi-environment deployment adds `APP_ENV` as a label only ([ADR 0008](adr/0008-production-mode-everywhere.md)).
- **Email sending in production.** SPF, DKIM, DMARC and a signed Resend bounce webhook come before the first real email ([docs/auth.md](auth.md#email)).

## Editing the diagrams

Each diagram is a Mermaid source in [`docs/diagrams/`](diagrams/), rendered with Pele into a light and a dark SVG themed with the design system's tokens. Change the `.mmd`, run `pnpm docs:diagrams`, and commit the source and both SVGs together with the doc they illustrate.
