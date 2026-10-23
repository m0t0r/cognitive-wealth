# custodian

The simulated custodian: the book of record for client holdings ([ADR 0009](../../docs/adr/0009-custodian-is-the-book-of-record.md)). It's a Python [FastAPI](https://fastapi.tiangolo.com) app run with [uv](https://docs.astral.sh/uv/) ([ADR 0011](../../docs/adr/0011-custodian-simulator-in-python.md)), and it shares no code with the TypeScript packages. Cognitive Wealth will reach it over HTTP through its OpenAPI contract.

For now it serves one route, `GET /health`, which returns `{"status": "ok"}`.

## Prerequisites

- [uv](https://docs.astral.sh/uv/getting-started/installation/) (`brew install uv`). It installs the pinned Python (`.python-version`) and the locked dependencies (`uv.lock`) into `.venv/` on first run; there's no separate install step.

## Running

From the repo root, through the package scripts (each calls `uv run`):

| Command                               | What it does                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| `pnpm --filter custodian dev`         | Uvicorn with reload at `https://custodian.cognitive-wealth.localhost` (portless) |
| `pnpm --filter custodian test`        | pytest                                                                           |
| `pnpm --filter custodian lint`        | Ruff lint                                                                        |
| `pnpm --filter custodian format`      | Ruff format (`format:check` to check only)                                       |
| `pnpm --filter custodian check-types` | pyright, strict mode                                                             |

The root `pnpm dev`, `lint`, `format:check`, `check-types` and `test` include the custodian. A git worktree is served at `https://<branch>.custodian.cognitive-wealth.localhost`, and `PORTLESS=0` falls back to `http://127.0.0.1:8000`. FastAPI's interactive API docs are at `/docs` and the OpenAPI schema at `/openapi.json`.

## Layout

```
src/custodian/main.py   the FastAPI app and its routes
tests/                  pytest tests (test_*.py), through FastAPI's TestClient
pyproject.toml          dependencies and Ruff, pyright and pytest config
uv.lock                 locked dependencies (commit with pyproject.toml)
```

Add a dependency with `uv add <pkg>` (`uv add --dev <pkg>` for tooling).

## Conventions

The coding rules (synchronous routes, strict types, Pydantic models at the boundary, `Decimal` for money) and a Python-for-TypeScript cheat sheet are in [CLAUDE.md](CLAUDE.md).
