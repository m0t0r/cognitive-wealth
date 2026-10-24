# apps/custodian

The simulated custodian, the book of record for holdings ([ADR 0009](../../docs/adr/0009-custodian-is-the-book-of-record.md)), in Python with FastAPI ([ADR 0011](../../docs/adr/0011-custodian-simulator-in-python.md)). The owner is learning Python: keep code plain, and when a slice introduces an idiom the cheat sheet below doesn't cover, add a row.

## Layout and running

- `src/custodian/` is the package (src layout); `main.py` holds the FastAPI `app`, `models.py` the SQLAlchemy tables, `positions.py` the Positions rebuilt from the Ledger. `world.py` is the world file's format (the file itself, `world/v0.json`, and its generated `world/schema.json` are at the repo root, since Cognitive Wealth's seed reads them too), `ledger_fixture.py` the hand-written ledger in `fixtures/` that stands in for the market until the Close exists, and `load.py` the loader behind `pnpm --filter custodian world:load`. Tests are in `tests/`, named `test_*.py`; the ones that need Postgres are in `tests/integration/` and run under `test:integration` (Docker), so the root `pnpm test` runs without Docker.
- The database is Compose's `custodian-db`, a Postgres server of its own (`localhost:5434` with `compose.dev.yaml`). Alembic owns the schema: migrations are hand-written in `migrations/versions/` and applied by `pnpm --filter custodian db:migrate` as the `migrator` role (`DATABASE_URL`, `DATABASE_PASSWORD_FILE`); `test_migrations.py` fails when they and the models disagree. The service connects as `app`, created with `migrator` by `docker/initdb/01-roles.sh`.
- Python is pinned in `.python-version` and `requires-python`; dependencies are in `pyproject.toml` and locked in `uv.lock` (commit both). Add one with `uv add <pkg>` (`--dev` for tooling), never by hand-editing the lock.
- **Version policy**: Python is the newest minor release that every compiled dependency (pydantic-core, and later SQLAlchemy, greenlet, psycopg, numpy) ships wheels for: 3.15 today, with security fixes to October 2031. Python has no LTS line; each minor release gets five years of support. Bump it when a new minor release has those wheels, updating `.python-version`, `requires-python`, Ruff's `target-version` and pyright's `pythonVersion` together. Every dependency is on its latest stable release, as a `>=` floor in `pyproject.toml` (with a `<` cap only across a known breaking major, like Pydantic 3), and `uv.lock` pins the exact versions.
- Run through the package scripts, which call `uv run` (it syncs `.venv` first): `pnpm --filter custodian dev | lint | format | check-types | test`. The root `pnpm lint`, `format:check`, `check-types` and `test` include them. Oxfmt formats `pyproject.toml`; Ruff formats the Python.
- `pnpm dev` serves it through portless at `https://custodian.cognitive-wealth.localhost` (a worktree gets `https://<branch>.custodian.cognitive-wealth.localhost`).

## Rules

- **Synchronous code**: plain `def` routes and functions, no `async def`. FastAPI runs a `def` route in a thread pool.
- **Types everywhere**: pyright runs in strict mode and Ruff's `ANN` rules require every parameter and return annotated. No `Any`, no `# type: ignore` or `# pyright: ignore` without a comment saying why.
- **Pydantic models at the boundary**: a route takes and returns `BaseModel`s and declares the return type in its signature, so FastAPI validates the response and the OpenAPI contract stays exact.
- **Money** follows [ADR 0013](../../docs/adr/0013-money-shares-prices-and-rates-are-separate-types.md): never `float`. Use `Decimal`, round once when a value becomes recorded Money, and send amounts over JSON as decimal strings.
- **Positions count by Trade date** ([ADR 0015](../../docs/adr/0015-positions-counted-by-trade-date.md)): a row counts from its Trade date, and its Settlement date, though stored, never changes a Position. A Posting date only matters when the caller asks what was known on a given day (`known_on`). Positions are always rebuilt from the Ledger, never stored.
- **The world file is a contract**: `world.py`'s models are its format, and the TypeScript seed validates the same file against `world/schema.json`. After changing a model, run `pnpm --filter custodian world:schema` and commit the schema; `test_world.py` fails until you do.
- **Loading is idempotent**: `load.py` adds what's missing and refuses (`LoadConflict`) to change what's there, in one database transaction, so a second run changes nothing.
- **Grants per table**: `app` has no default privileges, so the migration that creates a table grants `app` exactly what it needs, and adds the table to `test_the_app_has_only_the_access_each_table_grants`. The Ledger and the prices are append-only: `app` gets `select` on them and `insert` on their data columns only, so the database sets `id` and `recorded_at`.
- **Tests** go through the public seam: routes with FastAPI's `TestClient`, not by calling handler functions; the database through the `session` fixture (a `Session` as `app`) or `database` (an engine per role). Each test builds its own state; nothing module-level is shared between tests. Tests never touch the dev database: a run starts its own throwaway Postgres in Testcontainers, each database test gets its own copy of the migrated database (dropped afterwards), `tests/conftest.py` unsets the shell's `DATABASE_URL`, and pytest-randomly shuffles the order every run (`--randomly-seed=last` reruns the previous order to reproduce a failure).

## Python for TypeScript developers

| Python (here)                                                  | TypeScript (rest of the repo)                             |
| -------------------------------------------------------------- | --------------------------------------------------------- |
| `uv` (`uv add`, `uv sync`, `uv run`)                           | `pnpm` (`pnpm add`, `pnpm install`, `pnpm exec`)          |
| `pyproject.toml` + `uv.lock`                                   | `package.json` + `pnpm-lock.yaml`                         |
| `.venv/` (the project's own interpreter and packages)          | `node_modules/`                                           |
| `[dependency-groups] dev`                                      | `devDependencies`                                         |
| Ruff (`ruff check`, `ruff format`)                             | Oxlint, Oxfmt                                             |
| pyright strict                                                 | `tsc --noEmit` with `strict`                              |
| type hints: `def f(x: int) -> str:`, `list[str]`, `X \| None`  | `function f(x: number): string`, `string[]`, `X \| null`  |
| `Literal["ok"]`                                                | the literal type `"ok"`                                   |
| Pydantic `BaseModel` (validates at runtime, gives types)       | a Zod schema plus `z.infer`                               |
| a module is a file; a folder with `__init__.py` is a package   | an ES module; a folder with `index.ts`                    |
| `from custodian.main import app`                               | `import { app } from "custodian/main"`                    |
| decorator `@app.get("/health")` registers the function below   | `app.get("/health", handler)`                             |
| pytest: a `test_*` function with bare `assert`                 | Vitest `it(...)` with `expect(...)`                       |
| pytest fixture (a function argument injected by name)          | Vitest test context (`test.extend`)                       |
| context manager: `with x as y:` (cleanup on exit)              | `try/finally`, or `using`                                 |
| `Decimal("0.10")` (standard library, exact)                    | a decimal library (`decimal.js`), never `number`          |
| `"""docstring"""` as a module's or function's first line       | a `/** JSDoc */` comment                                  |
| `def __add__(self, other: Money) -> Money:` (operator method)  | no operator overloading: a method such as `a.plus(b)`     |
| `_name` (private by convention; pyright strict enforces it)    | `#name` or `private name`                                 |
| `__all__ = ["Money", …]` (a module's public names)             | the module's `export`s                                    |
| `__slots__` plus a `__setattr__` that raises: immutable        | `readonly` fields and `Object.freeze`                     |
| `object.__setattr__(self, "_value", v)` in `__init__`          | assigning a `readonly` field in the constructor           |
| `__init__`, `__eq__`, `__hash__`, `__str__`, `__repr__`        | `constructor`, an `equals()` method, `toString()`         |
| `isinstance(x, int \| str)` (also narrows the type)            | `typeof x === "number" \|\| typeof x === "string"`        |
| `type[Money]` (the class itself, not an instance)              | `typeof Money`                                            |
| a string literal under an attribute: its docstring             | a `/** JSDoc */` comment above a field                    |
| `Context(prec=60, traps=[Inexact])`, `context.add(a, b)`       | a `Decimal.clone({ precision: 60 })` from decimal.js      |
| `# pyright: reportUnusedExpression=false` at a file's top      | an `/* oxlint-disable rule */` comment for the file       |
| `class RoundingRule(Enum): HALF_EVEN = …`                      | a union of string literals, or an `enum`                  |
| `@classmethod` (gets the class as `cls`), returning `Self`     | a `static` method returning `this`'s type                 |
| `ClassVar[Decimal \| None]` (one value per class)              | a `static` field                                          |
| `raise ValueError(…) from None` (hides the original error)     | `throw new Error(…)` inside a `catch`                     |
| `f"{value!r}"` (the value's `repr`, quotes and all)            | `` `${JSON.stringify(value)}` ``                          |
| `@pytest.mark.parametrize(("a", "b"), [(1, 2), …])`            | `it.each([[1, 2], …])`                                    |
| `with pytest.raises(TypeError):`                               | `expect(() => …).toThrow(TypeError)`                      |
| `# pyright: ignore[reportOperatorIssue]` on one line           | `// @ts-expect-error` (fails if there's no error)         |
| `__get_pydantic_core_schema__` (makes a class a field type)    | a custom Zod schema (`z.custom`, `.transform`)            |
| `x: Mapped[int] = mapped_column(…)` in a model class           | a column in Drizzle's `pgTable("t", { x: … })`            |
| `Mapped[Shares \| None]` (a nullable column)                   | a Drizzle column without `.notNull()`                     |
| `class Kind(StrEnum): FUND = "fund"`, as a Postgres enum       | `pgEnum("kind", ["fund", …])`                             |
| `TypeDecorator[Money]` (converts a column's values)            | Drizzle's `customType` with `toDriver`/`fromDriver`       |
| `with Session(engine) as session:` (synchronous)               | a Drizzle `db` (async there, and `await`ed)               |
| `session.add(row)`, then `session.commit()`                    | `await db.insert(table).values(row)`                      |
| `session.scalars(select(Transaction)).all()`                   | `await db.select().from(transaction)`                     |
| Alembic `upgrade()`/`downgrade()` in `migrations/versions/`    | a drizzle-kit migration in `migrations/`                  |
| a fixture that `yield`s: the code after it is the teardown     | `test.extend` with `await use(x)`, then the cleanup       |
| `@pytest.fixture(scope="session")`: once per run               | Vitest `globalSetup`, or a worker-scoped fixture          |
| `@contextmanager` on a `yield`ing function: `with f() as x:`   | a function taking a callback, cleaning up in `finally`    |
| `@pytest.fixture(autouse=True)`: runs for every test           | a `beforeEach` in the shared Vitest setup file            |
| `monkeypatch.delenv("X")` (put back after the test)            | `vi.stubEnv("X", undefined)`, restored after each         |
| `{**os.environ, "X": "1"}` (a copy with one key set)           | `{ ...process.env, X: "1" }`                              |
| `type Role = Literal["migrator", "app"]`                       | `type Role = "migrator" \| "app"`                         |
| `@dataclass(frozen=True)` (a class of readonly fields)         | a `Readonly<{ … }>` type                                  |
| `match x:` / `case {"a": str(v)}:` (checks shape, binds `v`)   | a type guard, then destructuring                          |
| `@model_validator(mode="after")` (checks a whole model)        | Zod's `.superRefine()`                                    |
| `ConfigDict(extra="forbid", frozen=True)`                      | `z.object({…}).strict()`, and `Readonly<…>`               |
| `Model.model_validate_json(text)`                              | `schema.parse(JSON.parse(text))`                          |
| `model.model_copy(update={"a": 1})` (a changed copy)           | `{ ...model, a: 1 }`                                      |
| `type Positions = dict[str, Shares]` (a type alias)            | `type Positions = Record<string, Shares>`                 |
| `{k: v for k, v in items if v}` (a dict comprehension)         | `Object.fromEntries(items.filter(…))`                     |
| `for index, row in enumerate(rows):`                           | `rows.forEach((row, index) => …)`                         |
| `if (found := lookup()):` (assign inside a condition)          | `const found = lookup(); if (found) …`                    |
| `Counter(keys)` (counts each value)                            | a `Map` of counts built with a loop                       |
| `with session.begin():` (commit, or roll back on an error)     | `await db.transaction(async (tx) => …)`                   |
| `relationship(remote_side=[id])` (a row pointing at its table) | a self-referencing `references(() => t.id)` in Drizzle    |
| `python -m custodian.load` runs `if __name__ == "__main__":`   | `node script.js`, with the code at the module's top level |
| `argparse.ArgumentParser`, `add_argument("--world")`           | `util.parseArgs` from `node:util`                         |
| `def f(a, b, *, c=None)`: after `*`, pass by name only (`c=…`) | an options object: `f(a, b, { c })`                       |
| `raise SystemExit("message")` (prints it, exits with 1)        | `console.error(message); process.exit(1)`                 |
| `Path(__file__).parents[2]` (two folders up from this file)    | `path.resolve(import.meta.dirname, "../..")`              |
| `Mapping[str, X]`, `Sequence[X]` (read-only views, as params)  | `ReadonlyMap<string, X>`, `readonly X[]`                  |
| `a \|= b` on dicts (merge `b` into `a`)                        | `Object.assign(a, b)`                                     |
| `[only] = items` (unpack; fails unless exactly one)            | `const [only] = items`, without the length check          |
| `zip(a, b, strict=False)` (pairs items up)                     | `a.map((x, i) => [x, b[i]])`                              |
| `sum(p.role == "primary" for p in people)` (`True` counts 1)   | `people.filter((p) => p.role === "primary").length`       |
| `@dataclass(frozen=True)` instances compare field by field     | a deep-equality check such as `isDeepStrictEqual`         |
