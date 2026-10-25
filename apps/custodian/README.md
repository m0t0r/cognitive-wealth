# custodian

The simulated custodian: the book of record for client holdings ([ADR 0009](../../docs/adr/0009-custodian-is-the-book-of-record.md)). It's a Python [FastAPI](https://fastapi.tiangolo.com) app run with [uv](https://docs.astral.sh/uv/) ([ADR 0011](../../docs/adr/0011-custodian-simulator-in-python.md)), and it shares no code with the TypeScript packages. Cognitive Wealth will reach it over HTTP through its OpenAPI contract.

For now it serves one route, `GET /health`, which returns `{"status": "ok"}`. Its ledger lives in a Postgres database of its own: Securities, their daily prices, Accounts and the append-only Transactions, Reversals included. An Account's Positions are never stored: `positions_as_of()` rebuilds them from its Transactions, counting by Trade date ([ADR 0015](../../docs/adr/0015-positions-counted-by-trade-date.md)).

Each day, the Custodian feed publishes what the Ledger says as one Delivery: `securities.csv`, `accounts.csv`, the `transactions.csv` posted that day, `positions.csv` and `prices.csv`, then `manifest.json` with each file's row count and SHA-256. The same data always gives the same bytes ([ADR 0017](../../docs/adr/0017-custodian-feed-format.md)); [the feed primer](../../docs/learn/03-custodian-feed-and-ingestion.md) shows 2 March's files.

## Prerequisites

- [uv](https://docs.astral.sh/uv/getting-started/installation/) (`brew install uv`). It installs the pinned Python (`.python-version`) and the locked dependencies (`uv.lock`) into `.venv/` on first run; there's no separate install step.
- Docker, for `test:integration` (Testcontainers) and the Compose database.

## Running

From the repo root, through the package scripts (each calls `uv run`):

| Command                                    | What it does                                                                     |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| `pnpm --filter custodian dev`              | Uvicorn with reload at `https://custodian.cognitive-wealth.localhost` (portless) |
| `pnpm --filter custodian test`             | pytest, without the database tests (no Docker needed)                            |
| `pnpm --filter custodian test:integration` | pytest against Postgres in Testcontainers, in random order                       |
| `pnpm --filter custodian db:migrate`       | Alembic migrations to head, as `DATABASE_URL` (+ `DATABASE_PASSWORD_FILE`)       |
| `pnpm --filter custodian world:load`       | Loads `world/v0.json`'s custodian half and `fixtures/ledger-v0.json`; idempotent |
| `pnpm --filter custodian world:schema`     | Regenerates `world/schema.json` from the world file's models                     |
| `pnpm --filter custodian openapi:write`    | Regenerates `openapi.json`, the contract, from the app                           |
| `pnpm --filter custodian feed:write`       | `--date 2026-03-02`: writes that day's Delivery to `.dev/custodian-feed/`        |
| `pnpm --filter custodian feed:examples`    | Rewrites `fixtures/feed/` from a throwaway Postgres (Docker), never the dev one  |
| `pnpm --filter custodian lint`             | Ruff lint                                                                        |
| `pnpm --filter custodian format`           | Ruff format (`format:check` to check only)                                       |
| `pnpm --filter custodian check-types`      | pyright, strict mode                                                             |

The root `pnpm dev`, `lint`, `format:check`, `check-types`, `test` and `test:integration` include the custodian. A git worktree is served at `https://<branch>.custodian.cognitive-wealth.localhost`, and `PORTLESS=0` falls back to `http://127.0.0.1:8000`. FastAPI's interactive API docs are at `/docs` (Swagger UI): the routes, and under **Schemas** every row of the Custodian feed and the Manifest, with each column's description and format. `/redoc` shows the same document, but lists only the schemas a route uses, so the feed's rows appear there once a route returns them. Both pages load their scripts from a CDN, so they need a network connection. The document itself is at `/openapi.json`, and committed as `openapi.json`: `@repo/custodian-client` generates Cognitive Wealth's `fetch` client and Zod schemas from it.

## Database

Compose runs the custodian's Postgres as `custodian-db`, a server of its own on a network no Cognitive Wealth service joins. Create its secrets with the loop at the top of `compose.yaml` (it skips files that exist), then from the main checkout:

```sh
docker compose -f compose.yaml -f compose.dev.yaml up -d custodian-db
DATABASE_URL=postgres://migrator@localhost:5434/custodian \
  DATABASE_PASSWORD_FILE=$PWD/.secrets/custodian_db_migrator_password \
  pnpm --filter custodian db:migrate
```

Then load the world as `app` (`DATABASE_URL=postgres://app@localhost:5434/custodian` with `.secrets/custodian_db_app_password`) with `pnpm --filter custodian world:load`.

`migrator` owns the schema and runs migrations; `app`, which the service connects as, reads and writes rows but can only insert and read Transactions and prices. Both are created on the volume's first start by `docker/initdb/01-roles.sh`. Amounts are `numeric(19, 2)` and share counts `numeric(19, 6)`, read back as `Money` and `Shares` ([ADR 0013](../../docs/adr/0013-money-shares-prices-and-rates-are-separate-types.md)).

## Image

`Dockerfile` builds one image from the repo root (`docker build -f apps/custodian/Dockerfile .`), which `docker compose up --build` runs twice: `custodian-migrate` applies the migrations as `migrator` and exits, then `custodian` serves the API as `app` on `http://127.0.0.1:8000` (`CUSTODIAN_PORT` changes the host port), with `/docs` there too. Load the world into that stack with `docker compose run --rm custodian python -m custodian.load`.

The build stage installs `uv.lock`'s runtime dependencies only (`uv sync --locked --no-dev`) with uv's pinned binary, and compiles everything to bytecode. The image holds Python, the virtualenv and the code, all owned by root, and runs as `nobody` on a read-only filesystem, without uv, pytest, Ruff or pyright. The project keeps its place under `/app/apps/custodian/`, next to `/app/world/`, because `world.py` and `ledger_fixture.py` find their files by climbing from their own path. Its base is `python:3.15-slim`, not distroless like `web`'s: Google's distroless Python ships Debian's Python, older than 3.15. Dependabot bumps the image pins and the `uv.lock` dependencies weekly, but not the Python minor version, which moves with the version policy in [CLAUDE.md](CLAUDE.md).

## Layout

```
src/custodian/main.py      the FastAPI app and its routes
src/custodian/models.py    SQLAlchemy models: Security, SecurityPrice, Account, Transaction
src/custodian/database.py  an engine from DATABASE_URL and DATABASE_PASSWORD_FILE
src/custodian/world.py     the world file's format, as Pydantic models
src/custodian/ledger_fixture.py  the hand-written ledger's format
src/custodian/load.py      world:load: the world's custodian half and the ledger, into Postgres
src/custodian/positions.py Positions and Settled cash rebuilt from the Ledger, as of a date
src/custodian/market_value.py  Positions × the latest prices, rounded once
src/custodian/feed.py      feed:write: one As-of date's Delivery, five CSV files and manifest.json
src/custodian/feed_store.py  where Deliveries are kept: put, get and list, in a local folder for now
fixtures/ledger-v0.json    Dana's week from docs/learn/01, plus the IRA's first day
../../world/               the world file (v0.json) and its JSON Schema, shared with the seed
../../world/invalid/       world files that each break one rule, which both loaders must reject
migrations/                Alembic: env.py and versions/
docker/initdb/             the roles script custodian-db runs on its first start
Dockerfile                 the image Compose runs as custodian and custodian-migrate
tests/                     pytest tests (test_*.py), through FastAPI's TestClient
tests/integration/         database tests: one Testcontainers Postgres, a database per test
pyproject.toml             dependencies and Ruff, pyright, pytest and Alembic config
uv.lock                    locked dependencies (commit with pyproject.toml)
```

Add a dependency with `uv add <pkg>` (`uv add --dev <pkg>` for tooling).

## Conventions

The coding rules (synchronous routes, strict types, Pydantic models at the boundary, `Decimal` for money) and a Python-for-TypeScript cheat sheet are in [CLAUDE.md](CLAUDE.md).
