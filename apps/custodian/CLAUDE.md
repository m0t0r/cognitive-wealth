# apps/custodian

The simulated custodian, the book of record for holdings ([ADR 0009](../../docs/adr/0009-custodian-is-the-book-of-record.md)), in Python with FastAPI ([ADR 0011](../../docs/adr/0011-custodian-simulator-in-python.md)). The owner is learning Python: keep code plain, and when a slice introduces an idiom the cheat sheet below doesn't cover, add a row. Keep a new row's cells within the table's current widths (62 characters for Python, 57 for TypeScript, as written, so `\|` counts as two): a wider cell makes Oxfmt re-pad every row, and the diff shows the whole table rewritten.

## Layout and running

- `src/custodian/` is the package (src layout); `main.py` holds the FastAPI `app`, `models.py` the SQLAlchemy tables, `positions.py` the Positions and Settled cash rebuilt from the Ledger, `market_value.py` their Market value, `contract.py` adds the feed's models to the app's OpenAPI document (written to `openapi.json` by `pnpm --filter custodian openapi:write`, shown at `/docs`), and `feed.py` the Custodian feed: each As-of date's Delivery, written by `pnpm --filter custodian feed:write --date <day>` through `feed_store.py`'s `FeedStore` into `.dev/custodian-feed/` at the repo root. `world.py` is the world file's format (the file itself, `world/v0.json`, and its generated `world/schema.json` are at the repo root, since Cognitive Wealth's seed reads them too), `ledger_fixture.py` the hand-written ledger in `fixtures/` that stands in for the market until the Close exists (it names Securities by identifier only), and `load.py` the loader behind `pnpm --filter custodian world:load`, which fills `security` from the Security catalog. The market data ([ADR 0019](../../docs/adr/0019-market-data-pinned-or-committed.md)) is in `market/`: `factor_file.py` gets the Factor file its Pin (`factor-file.pin.json`) names, through a per-machine cache named by SHA-256 (`FACTOR_FILE_CACHE`), and reads it; `treasury_yields.py` reads the committed `treasury-yields.csv` and rebuilds it (`yields:write`, by hand only); `security_catalog.py` is the format and rules of `security-catalog.json`, every Security and what drives its price, each entry naming the section of `docs/research/security-catalog.md` its numbers come from (a rule it adds gets a file in `fixtures/invalid-security-catalogs/`, listed in `cases.json`; a new identifier is checked against the listed symbols first, `docs/agents/web-research.md`); `build_record.py` records which inputs built the database and refuses another, which the API's start-up (`main.py`) and `world:load` both check. Tests use the fixture Pin in `fixtures/factor-file/` (`tests/conftest.py` sets `FACTOR_FILE_PIN` and the cache for every test) and never the network. Tests are in `tests/`, named `test_*.py`; the ones that need Postgres are in `tests/integration/` and run under `test:integration` (Docker), so the root `pnpm test` runs without Docker.
- The database is Compose's `custodian-db`, a Postgres server of its own (`localhost:5434` with `compose.dev.yaml`). Alembic owns the schema: migrations are hand-written in `migrations/versions/` (wrap every constraint name passed to an `op.create_*` call in `op.f("…")`, or the models' naming convention renames it, e.g. to `transaction_transaction_…_c_8bf6`) and applied by `pnpm --filter custodian db:migrate` as the `migrator` role (`DATABASE_URL`, `DATABASE_PASSWORD_FILE`); `test_migrations.py` fails when they and the models disagree. The service connects as `app`, created with `migrator` by `docker/initdb/01-roles.sh`. Under `docker compose up`, `Dockerfile`'s image runs the migrations as `custodian-migrate`, then serves the app as `custodian` (README, "Image"); a new file the running app or `world:load` reads must also be copied into that image.
- Python is pinned in `.python-version` and `requires-python`; dependencies are in `pyproject.toml` and locked in `uv.lock` (commit both). Add one with `uv add <pkg>` (`--dev` for tooling), never by hand-editing the lock.
- **Version policy**: Python is the newest minor release that every compiled dependency (pydantic-core, and later SQLAlchemy, greenlet, psycopg, numpy) ships wheels for: 3.15 today, with security fixes to October 2031. Python has no LTS line; each minor release gets five years of support. Bump it when a new minor release has those wheels, updating `.python-version`, `requires-python`, Ruff's `target-version` and pyright's `pythonVersion` together. Every dependency is on its latest stable release, as a `>=` floor in `pyproject.toml` (with a `<` cap only across a known breaking major, like Pydantic 3), and `uv.lock` pins the exact versions.
- Run through the package scripts, which call `uv run` (it syncs `.venv` first): `pnpm --filter custodian dev | lint | format | check-types | test`. pnpm 12 forwards a script's arguments without `--` (`pnpm --filter custodian feed:write --date 2026-03-06`), and a `--` you add reaches the script as an argument. The scripts with a `main` drop a leading one (`cli.py`'s `script_args`), but pytest doesn't: to run one test file from the repo root, call uv directly: `uv run --directory apps/custodian pytest -q tests/<file>.py` (`pnpm --filter custodian test -- <file>` collects nothing, and `--directory` with `--project` resolves the project inside the directory). The root `pnpm lint`, `format:check`, `check-types` and `test` include them. Oxfmt formats `pyproject.toml`; Ruff formats the Python.
- `pnpm dev` serves it through portless at `https://custodian.cognitive-wealth.localhost` (a worktree gets `https://<branch>.custodian.cognitive-wealth.localhost`).

## Rules

- **Synchronous code**: plain `def` routes and functions, no `async def`. FastAPI runs a `def` route in a thread pool. The one exception is `main.py`'s start-up hook, which Starlette only takes as `async`; it runs its blocking check in a thread.
- **Types everywhere**: pyright runs in strict mode and Ruff's `ANN` rules require every parameter and return annotated. No `Any`, no `# type: ignore` or `# pyright: ignore` without a comment saying why.
- **Pydantic models at the boundary**: a route takes and returns `BaseModel`s and declares the return type in its signature, so FastAPI validates the response and the OpenAPI contract stays exact.
- **Money** follows [ADR 0013](../../docs/adr/0013-money-shares-prices-and-rates-are-separate-types.md): never `float`. Use `Decimal`, round once when a value becomes recorded Money, and send amounts over JSON as decimal strings.
- **Positions count by Trade date** ([ADR 0015](../../docs/adr/0015-positions-counted-by-trade-date.md)): a row counts from its Trade date, and its Settlement date, though stored, never changes a Position. A Posting date only matters when the caller asks what was known on a given day (`known_on`). Positions are always rebuilt from the Ledger, never stored. Settled cash is the one number that uses the Settlement date, for money coming in ([ADR 0016](../../docs/adr/0016-settled-cash-and-market-value-rules.md)).
- **The world file is a contract**: `world.py`'s models are its format, and the TypeScript seed validates the same file against `world/schema.json`. After changing a model, run `pnpm --filter custodian world:schema` and commit the schema; `test_world.py` fails until you do. The schema checks each field on its own, so prefer a shape that makes a rule impossible to break (one `primary` field, roles held by each Person) over a check in Python. A rule that needs the whole file goes in `WorldFile`'s validator and gets a file in `world/invalid/`, listed in `cases.json` with the field its error names and `"caught_by": "rules"`: the TypeScript seed's tests read the same files, so both loaders reject them.
- **The API is a contract** ([ADR 0011](../../docs/adr/0011-custodian-simulator-in-python.md)): Cognitive Wealth only knows the committed `openapi.json`, from which `@repo/custodian-client` generates a `fetch` client and Zod schemas. After changing a route, a row model or a type they use, run `pnpm --filter custodian openapi:write`, then `pnpm --filter @repo/custodian-client generate`, and commit both; `test_contract.py` and the client's `generated.test.ts` fail until you do. A model only the feed uses goes in `contract.py`'s `FEED_MODELS`, and a field's docstring is its description at `/docs`. Money and Shares are sent at exactly their scale (`-9.00`, `40.000000`), so their patterns in the contract require it (`money.py`'s `contract_pattern`). `fixtures/feed/` holds two Deliveries the client's tests parse row by row; `test_feed.py` fails when the writer no longer writes them, and `pnpm --filter custodian feed:examples` rewrites them from a throwaway Postgres (Docker), never the dev database.
- **The feed's bytes depend on the data alone** ([ADR 0017](../../docs/adr/0017-custodian-feed-format.md)): no "now" in a file, rows sorted in Python (not `order by`, whose collation varies), Positions as known on the As-of date, and the Manifest written last. Every Transaction gets a `transaction_id` from whoever records it, never a random default, so a rebuilt world writes the same Deliveries. Changing a row model changes the format: raise `Manifest.format_version` (its type and the value `write_delivery` passes; pyright fails until both agree), run `feed:examples`, and update the primer's 2 March files, which `test_feed.py` checks.
- **A market input's bytes depend on its data alone** ([ADR 0019](../../docs/adr/0019-market-data-pinned-or-committed.md)): the build record keeps each input's SHA-256, and a database whose record differs must be rebuilt from empty. So a hashed file (`treasury-yields.csv`, `security-catalog.json`) holds no retrieval date, run time or other "now": provenance goes in an unhashed file beside it (`treasury-yields.source.json`), and a rebuild that finds the same data writes nothing. `test_the_committed_file_depends_on_its_yields_alone` rewrites the yields from their own rows and expects the same bytes.
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
| `uv sync --locked --no-dev` (runtime deps, lock must match)    | `pnpm install --frozen-lockfile --prod`                   |
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
| `sum(len(x) for x in xs)` (adds up a generator expression)     | `xs.reduce((total, x) => total + x.length, 0)`            |
| a `def` that `yield`s, returning `Iterator[X]` (a generator)   | a `function*` generator, returning `Iterator<X>`          |
| `@pytest.mark.parametrize(…, ids=lambda case: case.file)`      | `it.each(cases)("$file", …)`                              |
| `with pytest.raises(E) as caught:`, then `caught.value`        | `expect(() => …).toThrow()`, or a `try/catch` to inspect  |
| `@dataclass(frozen=True)` instances compare field by field     | a deep-equality check such as `isDeepStrictEqual`         |
| `aliased(Transaction)`: the same table joined a second time    | Drizzle's `alias(transaction, "original")`                |
| `case((x < 0, a), else_=b)` (SQL `case when … then … else`)    | a `sql` template with `case when … end` in Drizzle        |
| `frozenset({"LKBF"})` (an immutable set)                       | a `ReadonlySet<string>`                                   |
| `class FeedStore(Protocol):` (any class with its methods fits) | an `interface`: TypeScript's types are structural too     |
| `@property` on a method: read as `row.transaction_id`          | a `get transactionId()` accessor                          |
| `hashlib.sha256(content).hexdigest()` (hex Content hash)       | `createHash("sha256").update(b).digest("hex")`            |
| `csv.writer(text, lineterminator="\n")` (quotes as needed)     | a CSV library such as `csv-stringify`                     |
| `os.replace(partial, path)`: rename over a file in one step    | `fs.renameSync(partial, path)`                            |
| `io.StringIO()`: a string to write into like a file            | an array of strings, `join`ed at the end                  |
| `sorted(rows, key=lambda row: row.identifier)`                 | `rows.toSorted((a, b) => …)` with a compare function      |
| `model.model_dump(mode="json")`: a dict of JSON-ready values   | `JSON.parse(JSON.stringify(value))`, roughly              |
| `class RecordingStore(LocalFeedStore):`, `super().__init__(…)` | `class A extends B`, then `super(…)` in the constructor   |
| `__get_pydantic_json_schema__` (edits a type's JSON Schema)    | `.meta()` or `.regex()` on a Zod schema                   |
| `d.setdefault("k", {})`: `d["k"]`, set to `{}` if missing      | `d.k ??= {}`, then `d.k`                                  |
| `_, schemas = f()`: unpack a tuple, `_` for the part not used  | `const [, schemas] = f()`                                 |
| `[(m, "serialization") for m in models]`: a list comprehension | `models.map((m) => [m, "serialization"])`                 |
| `rf"\d{{{n}}}"`: raw f-string, where `{{` is a literal `{`     | a `String.raw` template literal with `${n}`               |
| `if match := pattern.search(text):` (assign, then test)        | `const match = pattern.exec(text); if (match) …`          |
| `re.compile(r"^FROM …$", re.MULTILINE)`: `^` per line          | the `m` flag: `/^FROM …$/m`                               |
| `@cache` on a `def` with no arguments: its body runs once      | a module-level flag that guards a one-time call           |
| `atexit.register(link.close)`: runs it when Python exits       | `process.on("exit", () => link.close())`                  |
| `except BaseException:` catches Ctrl-C too, not just errors    | a `catch` (a signal isn't an exception in Node)           |
| `threading.Thread(target=f, daemon=True).start()`              | a `Worker`, roughly (or just an async callback)           |
| `with suppress(NotFound):` ignores that one error in the block | a `catch` that rethrows anything but `NotFound`           |
| `[*misses, None]`: a new list, `misses` spread, then `None`    | `[...misses, null]`                                       |
| `field(default_factory=list[str])`: a fresh list per instance  | a field initialiser such as `filters: string[] = []`      |
| `with (a() as x, b()):` enters both; leaves them in reverse    | two nested `using` declarations                           |
| a `def` in a `def` sees outer locals (`nonlocal` to rebind)    | a closure: an inner function or arrow                     |
| `zipfile.ZipFile(path)`, then `archive.read(name)`: unzip one  | a zip library such as `yauzl`                             |
| `urllib.request.urlopen(url, timeout=60)`: an HTTP GET         | `await fetch(url, { signal: AbortSignal.timeout(…) })`    |
| `while chunk := response.read(n):` reads until it's empty      | `for await (const chunk of response.body)`                |
| `tempfile.NamedTemporaryFile(dir=d, delete=False)`             | `fs.mkdtempSync`, or a random name in the same folder     |
| `Decimal("0.41").scaleb(-2)` is `0.0041`, moved exactly        | `new Decimal("0.41").div(100)` in decimal.js              |
| `@asynccontextmanager`: code before `yield` runs at start-up   | a server's start-up hook, run before `listen()`           |
| `class H(BaseHTTPRequestHandler)`: a tiny test HTTP server     | `http.createServer((req, res) => …)`                      |
| `await run_in_threadpool(f)`: blocking `f` off the event loop  | a `Worker`, roughly: Node has no thread pool for JS       |
| `dataclasses.replace(x, a=1)`: a changed copy of a dataclass   | `{ ...x, a: 1 }`                                          |
| `except (OSError, HTTPException):` catches either type         | a `catch` that tests `instanceof` for each                |
| `Rate.from_percent("0.41")`, a `@classmethod` constructor      | a `static fromPercent()` factory method                   |
| `Field(discriminator="type")` on `A \| B`: picks by `type`     | `z.discriminatedUnion("type", [a, b])`                    |
| `Annotated[Decimal, Field(gt=0)]`: a type with a constraint    | `z.number().positive()`, as a named schema                |
| `BeforeValidator(f)`: `f` sees the raw value before parsing    | `z.preprocess(f, schema)`                                 |
| `Counter(xs)`: how many times each item occurs, as a dict      | `Map.groupBy(xs, (x) => x)`, then each group's length     |
