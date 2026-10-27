# custodian

The simulated custodian: the book of record for client holdings ([ADR 0009](../../docs/adr/0009-custodian-is-the-book-of-record.md)). It's a Python [FastAPI](https://fastapi.tiangolo.com) app run with [uv](https://docs.astral.sh/uv/) ([ADR 0011](../../docs/adr/0011-custodian-simulator-in-python.md)), and it shares no code with the TypeScript packages. Cognitive Wealth will reach it over HTTP through its OpenAPI contract.

For now it serves one route, `GET /health`, which returns `{"status": "ok"}`. Its ledger lives in a Postgres database of its own: Securities, their daily prices, Accounts and the append-only Transactions, Reversals included. An Account's Positions are never stored: `positions_as_of()` rebuilds them from its Transactions, counting by Trade date ([ADR 0015](../../docs/adr/0015-positions-counted-by-trade-date.md)).

Each day, the Custodian feed publishes what the Ledger says as one Delivery: `securities.csv`, `accounts.csv`, the `transactions.csv` posted that day, `positions.csv` and `prices.csv`, then `manifest.json` with each file's row count and SHA-256. The same data always gives the same bytes ([ADR 0017](../../docs/adr/0017-custodian-feed-format.md)); [the feed primer](../../docs/learn/03-custodian-feed-and-ingestion.md) shows 2 March's files.

## Market data

The world's prices will come from real market history ([ADR 0019](../../docs/adr/0019-market-data-pinned-or-committed.md)):

- **The Factor file**, Kenneth French's daily three-factor returns. `market/factor-file.pin.json` is its Pin: the Wayback Machine copy it's downloaded from, the library's own address (never fetched), its SHA-256, the CRSP month it was built from and its last date. On the first start (`pnpm dev`, `world:load` or the container) it's downloaded into `~/.cache/cognitive-wealth/factor-files/<sha256>.zip`, one cache for every checkout on the machine (`FACTOR_FILE_CACHE` moves it; Compose uses the `custodian-factor-files` volume). Every start after that checks the cached copy's hash. A mismatch, or no network with an empty cache, stops the custodian with a message saying which.
- **Treasury yields**, the US Treasury's daily par yield curve, committed as `market/treasury-yields.csv` from 2020 to the Factor file's last date. The file holds only the yields, so its SHA-256 changes only when a yield does; where and when they were retrieved is in `market/treasury-yields.source.json`. Rerunning `yields:write` on unchanged yields writes nothing.
- **The Security catalog**, `market/security-catalog.json`: every Security in the world (about 20 invented US funds and stocks, plus the Cash sweep), with what drives its price: Factor exposures, a Treasury tenor and duration, a blend of the two, or nothing for the sweep, plus its own volatility. They're all US Securities, a labelled simplification: with only US factors and US yields, nothing moves when another market falls alone. Every number comes from a section of [docs/research/security-catalog.md](../../docs/research/security-catalog.md), which each entry names. `world:load` fills the `security` table (identifier, name, kind) from it; the exposures stay in the file. `fixtures/invalid-security-catalogs/` holds a catalog breaking each rule `security_catalog.py` checks.
- **The build record**: the first `world:load` records each input's SHA-256 (and the Factor file's CRSP month, for the message) in the database, and from then on `world:load` and the API refuse a database built from other inputs. After moving the Pin, rebuild the database from empty.

Tests never touch the network: they use the made-up Factor file and Pin in `fixtures/factor-file/`.

**Keep a backup of the pinned zip.** The Wayback Machine's capture is its only public source: if the archive is down, a machine with nothing cached can't start, and if the capture is removed, nobody can download it again. Copy `~/.cache/cognitive-wealth/factor-files/<sha256>.zip` somewhere private (never into the repo: the file is copyrighted). To restore it, or to set up a machine without the network, copy it back into that folder under the same name; every start checks its SHA-256, so a copy is trusted exactly like a download.

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
| `pnpm --filter custodian world:load`       | Loads `world/v0.json`, the Security catalog and the ledger fixture; idempotent   |
| `pnpm --filter custodian world:schema`     | Regenerates `world/schema.json` from the world file's models                     |
| `pnpm --filter custodian yields:write`     | Rebuilds `market/treasury-yields.csv` from the Treasury; by hand, when Pin moves |
| `pnpm --filter custodian openapi:write`    | Regenerates `openapi.json`, the contract, from the app                           |
| `pnpm --filter custodian feed:write`       | `--date 2026-03-02`: writes that day's Delivery to `.dev/custodian-feed/`        |
| `pnpm --filter custodian feed:examples`    | Rewrites `fixtures/feed/` from a throwaway Postgres (Docker), never the dev one  |
| `pnpm --filter custodian lint`             | Ruff lint                                                                        |
| `pnpm --filter custodian format`           | Ruff format (`format:check` to check only)                                       |
| `pnpm --filter custodian check-types`      | pyright, strict mode                                                             |

`world:load`, `feed:write` and `yields:write` keep `pnpm cw`'s contract (ADR 0026, #236), so an agent reads them the way it reads `cw`. Each prints its result as data: TOON by default, JSON with `--json`. A failure exits 1 with `{ code, message, retryable, cta }` (`no_database`, `build_record_differs`, `load_conflict`, …), and `cta` names the command to run next: after `world:load`, the `feed:write` for the ledger's last day; after `feed:write`, `pnpm cw custodian ingest`. A `yields:write` that changed the file says `rebuildNeeded: true` and points at "Rebuilding it from empty" below, but never as a `cta`: the rebuild deletes the local custodian data, so an agent asks the user first. Each takes `--dry-run`, which writes nothing, and `--schema` prints its options and output. `--llms` on any of them lists all three (`--llms --json` adds each one's options and output). A relative path option (`--root`, `--world`, `--ledger`) is read from the folder the command was typed in, as in `cw`, though pnpm runs the script in `apps/custodian`. `cli.py` is the runner they share.

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

### Rebuilding it from empty

When a market input changes (the Pin moves, the yields or the Security catalog change), `world:load` and the API refuse the database with "must be rebuilt from an empty database". So does a database whose build record was written before the catalog's hash joined it (migration 0006, #183), which records an empty hash. A database with no build record yet (never loaded since #45) isn't refused: the next load just adds what's missing. To rebuild, from the main checkout, delete the custodian's volume (the dev stack's project is `cognitive-wealth`, so it's `cognitive-wealth_custodian-pgdata`) and start again. The roles script runs again on the new volume, and the Factor file's cache, a volume of its own, is kept:

```sh
docker compose -f compose.yaml -f compose.dev.yaml rm --stop --force custodian custodian-db
docker volume rm cognitive-wealth_custodian-pgdata
docker compose -f compose.yaml -f compose.dev.yaml up -d custodian-db
```

Then migrate and load as above. Under the full stack, `docker compose up --build` migrates it, and `docker compose run --rm custodian python -m custodian.load` loads it.

`migrator` owns the schema and runs migrations; `app`, which the service connects as, reads and writes rows but can only insert and read Transactions and prices. Both are created on the volume's first start by `docker/initdb/01-roles.sh`. Amounts are `numeric(19, 2)` and share counts `numeric(19, 6)`, read back as `Money` and `Shares` ([ADR 0013](../../docs/adr/0013-money-shares-prices-and-rates-are-separate-types.md)).

## Image

`Dockerfile` builds one image from the repo root (`docker build -f apps/custodian/Dockerfile .`), which `docker compose up --build` runs twice: `custodian-migrate` applies the migrations as `migrator` and exits, then `custodian` serves the API as `app` on `http://127.0.0.1:8000` (`CUSTODIAN_PORT` changes the host port), with `/docs` there too. Load the world into that stack with `docker compose run --rm custodian python -m custodian.load`.

The build stage installs `uv.lock`'s runtime dependencies only (`uv sync --locked --no-dev`) with uv's pinned binary, and compiles everything to bytecode. The image holds Python, the virtualenv and the code, all owned by root, and runs as `nobody` (on a read-only filesystem under Compose's hardening), without uv, pytest, Ruff or pyright. The project keeps its place under `/app/apps/custodian/`, next to `/app/world/`, because `world.py` and `ledger_fixture.py` find their files by climbing from their own path. The image holds `market/` (the Pin, the yields and the Security catalog) but never the Factor file: nothing is downloaded during the build, and the running container downloads it once into `/var/cache/custodian/factor-files`, the one folder `nobody` can write, where Compose mounts the `custodian-factor-files` volume. Its base is `python:3.15-slim`, not distroless like `web`'s: Google's distroless Python ships Debian's Python, older than 3.15. Dependabot bumps the image pins and the `uv.lock` dependencies weekly, but not the Python minor version, which moves with the version policy in [CLAUDE.md](CLAUDE.md).

## Layout

```
src/custodian/main.py      the FastAPI app and its routes
src/custodian/models.py    SQLAlchemy models: Security, SecurityPrice, Account, Transaction
src/custodian/database.py  an engine from DATABASE_URL and DATABASE_PASSWORD_FILE
src/custodian/cli.py       the scripts' runner: cw's output, error codes, cta, --schema and --llms
src/custodian/world.py     the world file's format, as Pydantic models
src/custodian/ledger_fixture.py  the hand-written ledger's format
src/custodian/load.py      world:load: the world's custodian half, the catalog and the ledger
src/custodian/positions.py Positions and Settled cash rebuilt from the Ledger, as of a date
src/custodian/market_value.py  Positions × the latest prices, rounded once
src/custodian/feed.py      feed:write: one As-of date's Delivery, five CSV files and manifest.json
src/custodian/feed_store.py  where Deliveries are kept: put, get and list, in a local folder for now
src/custodian/factor_file.py  the Pin, the cached and hash-checked Factor file, and its reader
src/custodian/treasury_yields.py  the committed yields' reader, and yields:write
src/custodian/security_catalog.py  the Security catalog's format and rules
src/custodian/build_record.py  which market inputs built the database, checked on every start
market/                    the Factor file's Pin, the committed Treasury yields, the Security catalog
fixtures/factor-file/      the tests' made-up Factor file, under its SHA-256, and its Pin
fixtures/invalid-security-catalogs/  catalogs that each break one rule, listed in cases.json
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
