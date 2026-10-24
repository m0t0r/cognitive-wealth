# custodian

The simulated custodian: the book of record for client holdings ([ADR 0009](../../docs/adr/0009-custodian-is-the-book-of-record.md)). It's a Python [FastAPI](https://fastapi.tiangolo.com) app run with [uv](https://docs.astral.sh/uv/) ([ADR 0011](../../docs/adr/0011-custodian-simulator-in-python.md)), and it shares no code with the TypeScript packages. Cognitive Wealth will reach it over HTTP through its OpenAPI contract.

For now it serves one route, `GET /health`, which returns `{"status": "ok"}`. Its ledger lives in a Postgres database of its own: Securities, their daily prices, Accounts and the append-only Transactions, Reversals included. An Account's Positions are never stored: `positions_as_of()` rebuilds them from its Transactions, counting by Trade date ([ADR 0015](../../docs/adr/0015-positions-counted-by-trade-date.md)).

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
| `pnpm --filter custodian lint`             | Ruff lint                                                                        |
| `pnpm --filter custodian format`           | Ruff format (`format:check` to check only)                                       |
| `pnpm --filter custodian check-types`      | pyright, strict mode                                                             |

The root `pnpm dev`, `lint`, `format:check`, `check-types`, `test` and `test:integration` include the custodian. A git worktree is served at `https://<branch>.custodian.cognitive-wealth.localhost`, and `PORTLESS=0` falls back to `http://127.0.0.1:8000`. FastAPI's interactive API docs are at `/docs` and the OpenAPI schema at `/openapi.json`.

## Database

Compose runs the custodian's Postgres as `custodian-db`, a server of its own on a network no Cognitive Wealth service joins. Create its secrets with the loop at the top of `compose.yaml` (it skips files that exist), then from the main checkout:

```sh
docker compose -f compose.yaml -f compose.dev.yaml up -d custodian-db
DATABASE_URL=postgres://migrator@localhost:5434/custodian \
  DATABASE_PASSWORD_FILE=$PWD/.secrets/custodian_db_migrator_password \
  pnpm --filter custodian db:migrate
```

Then load the world as `app` (`DATABASE_URL=postgres://app@localhost:5434/custodian` with `.secrets/custodian_db_app_password`) with `pnpm --filter custodian world:load`.

`migrator` owns the schema and runs migrations; `app`, which the service will connect as, reads and writes rows but can only insert and read Transactions and prices. Both are created on the volume's first start by `docker/initdb/01-roles.sh`. Amounts are `numeric(19, 2)` and share counts `numeric(19, 6)`, read back as `Money` and `Shares` ([ADR 0013](../../docs/adr/0013-money-shares-prices-and-rates-are-separate-types.md)).

## Layout

```
src/custodian/main.py      the FastAPI app and its routes
src/custodian/models.py    SQLAlchemy models: Security, SecurityPrice, Account, Transaction
src/custodian/database.py  an engine from DATABASE_URL and DATABASE_PASSWORD_FILE
src/custodian/world.py     the world file's format, as Pydantic models
src/custodian/ledger_fixture.py  the hand-written ledger's format
src/custodian/load.py      world:load: the world's custodian half and the ledger, into Postgres
src/custodian/positions.py Positions rebuilt from the Ledger, as of a date
fixtures/ledger-v0.json    Dana's week from docs/learn/01, plus the IRA's first day
../../world/               the world file (v0.json) and its JSON Schema, shared with the seed
migrations/                Alembic: env.py and versions/
docker/initdb/             the roles script custodian-db runs on its first start
tests/                     pytest tests (test_*.py), through FastAPI's TestClient
tests/integration/         database tests: one Testcontainers Postgres, a database per test
pyproject.toml             dependencies and Ruff, pyright, pytest and Alembic config
uv.lock                    locked dependencies (commit with pyproject.toml)
```

Add a dependency with `uv add <pkg>` (`uv add --dev <pkg>` for tooling).

## Conventions

The coding rules (synchronous routes, strict types, Pydantic models at the boundary, `Decimal` for money) and a Python-for-TypeScript cheat sheet are in [CLAUDE.md](CLAUDE.md).
