# apps/custodian

The simulated custodian, the book of record for holdings ([ADR 0009](../../docs/adr/0009-custodian-is-the-book-of-record.md)), in Python with FastAPI ([ADR 0011](../../docs/adr/0011-custodian-simulator-in-python.md)). The owner is learning Python: keep code plain, and when a slice introduces an idiom the cheat sheet below doesn't cover, add a row.

## Layout and running

- `src/custodian/` is the package (src layout); `main.py` holds the FastAPI `app`. Tests are in `tests/`, named `test_*.py`.
- Python is pinned in `.python-version` and `requires-python`; dependencies are in `pyproject.toml` and locked in `uv.lock` (commit both). Add one with `uv add <pkg>` (`--dev` for tooling), never by hand-editing the lock.
- **Version policy**: Python is the newest minor release that every compiled dependency (pydantic-core, and later SQLAlchemy, greenlet, psycopg, numpy) ships wheels for: 3.15 today, with security fixes to October 2031. Python has no LTS line; each minor release gets five years of support. Bump it when a new minor release has those wheels, updating `.python-version`, `requires-python`, Ruff's `target-version` and pyright's `pythonVersion` together. Every dependency is on its latest stable release, as a `>=` floor in `pyproject.toml` (with a `<` cap only across a known breaking major, like Pydantic 3), and `uv.lock` pins the exact versions.
- Run through the package scripts, which call `uv run` (it syncs `.venv` first): `pnpm --filter custodian dev | lint | format | check-types | test`. The root `pnpm lint`, `format:check`, `check-types` and `test` include them. Oxfmt formats `pyproject.toml`; Ruff formats the Python.
- `pnpm dev` serves it through portless at `https://custodian.cognitive-wealth.localhost` (a worktree gets `https://<branch>.custodian.cognitive-wealth.localhost`).

## Rules

- **Synchronous code**: plain `def` routes and functions, no `async def`. FastAPI runs a `def` route in a thread pool.
- **Types everywhere**: pyright runs in strict mode and Ruff's `ANN` rules require every parameter and return annotated. No `Any`, no `# type: ignore` or `# pyright: ignore` without a comment saying why.
- **Pydantic models at the boundary**: a route takes and returns `BaseModel`s and declares the return type in its signature, so FastAPI validates the response and the OpenAPI contract stays exact.
- **Money** follows [ADR 0013](../../docs/adr/0013-money-shares-prices-and-rates-are-separate-types.md): never `float`. Use `Decimal`, round once when a value becomes recorded Money, and send amounts over JSON as decimal strings.
- **Tests** go through the public seam: routes with FastAPI's `TestClient`, not by calling handler functions. Each test builds its own state; nothing module-level is shared between tests.

## Python for TypeScript developers

| Python (here)                                                 | TypeScript (rest of the repo)                            |
| ------------------------------------------------------------- | -------------------------------------------------------- |
| `uv` (`uv add`, `uv sync`, `uv run`)                          | `pnpm` (`pnpm add`, `pnpm install`, `pnpm exec`)         |
| `pyproject.toml` + `uv.lock`                                  | `package.json` + `pnpm-lock.yaml`                        |
| `.venv/` (the project's own interpreter and packages)         | `node_modules/`                                          |
| `[dependency-groups] dev`                                     | `devDependencies`                                        |
| Ruff (`ruff check`, `ruff format`)                            | Oxlint, Oxfmt                                            |
| pyright strict                                                | `tsc --noEmit` with `strict`                             |
| type hints: `def f(x: int) -> str:`, `list[str]`, `X \| None` | `function f(x: number): string`, `string[]`, `X \| null` |
| `Literal["ok"]`                                               | the literal type `"ok"`                                  |
| Pydantic `BaseModel` (validates at runtime, gives types)      | a Zod schema plus `z.infer`                              |
| a module is a file; a folder with `__init__.py` is a package  | an ES module; a folder with `index.ts`                   |
| `from custodian.main import app`                              | `import { app } from "custodian/main"`                   |
| decorator `@app.get("/health")` registers the function below  | `app.get("/health", handler)`                            |
| pytest: a `test_*` function with bare `assert`                | Vitest `it(...)` with `expect(...)`                      |
| pytest fixture (a function argument injected by name)         | Vitest test context (`test.extend`)                      |
| context manager: `with x as y:` (cleanup on exit)             | `try/finally`, or `using`                                |
| `Decimal("0.10")` (standard library, exact)                   | a decimal library (`decimal.js`), never `number`         |
| `"""docstring"""` as a module's or function's first line      | a `/** JSDoc */` comment                                 |
| `def __add__(self, other: Money) -> Money:` (operator method) | no operator overloading: a method such as `a.plus(b)`    |
| `_name` (private by convention; pyright strict enforces it)   | `#name` or `private name`                                |
| `__all__ = ["Money", …]` (a module's public names)            | the module's `export`s                                   |
| `__slots__` plus a `__setattr__` that raises: immutable       | `readonly` fields and `Object.freeze`                    |
| `class RoundingRule(Enum): HALF_EVEN = …`                     | a union of string literals, or an `enum`                 |
| `@classmethod` (gets the class as `cls`), returning `Self`    | a `static` method returning `this`'s type                |
| `ClassVar[Decimal \| None]` (one value per class)             | a `static` field                                         |
| `raise ValueError(…) from None` (hides the original error)    | `throw new Error(…)` inside a `catch`                    |
| `f"{value!r}"` (the value's `repr`, quotes and all)           | `` `${JSON.stringify(value)}` ``                         |
| `@pytest.mark.parametrize(("a", "b"), [(1, 2), …])`           | `it.each([[1, 2], …])`                                   |
| `with pytest.raises(TypeError):`                              | `expect(() => …).toThrow(TypeError)`                     |
| `# pyright: ignore[reportOperatorIssue]` on one line          | `// @ts-expect-error` (fails if there's no error)        |
| `__get_pydantic_core_schema__` (makes a class a field type)   | a custom Zod schema (`z.custom`, `.transform`)           |
