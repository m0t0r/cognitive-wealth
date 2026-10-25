# ADR 0018: TypeScript integration tests run on a real Postgres

- Status: accepted
- Date: 2026-10-25

Until now the TypeScript integration tests ran on PGlite, Postgres compiled to WebAssembly and run in-process, and only tests that needed more (#154) used a real Postgres in Testcontainers. #83 set a rule before measuring: if `@repo/auth`, the biggest suite, ran at most 30% slower on real Postgres, real Postgres would become the default everywhere. It ran faster, so every TypeScript integration test now runs on the real server, through the app's own driver and logins.

1. **One harness.** `test` from `@repo/db/testing` gives each test a database of its own on a real Postgres (compose.yaml's image, with the production roles from `01-roles.sh`), reached through postgres.js as the app reaches it: `orm` signs in as `app` with a password, `migratorOrm` as `migrator`, and `connect(role)` opens another pool. Every package with integration tests names `@repo/db/postgres-setup` as its Vitest global setup.
2. **One server for the root run.** `pnpm test:integration` runs `turbo run test:integration` under `packages/testing/src/cli/with-postgres.ts`, which starts one Postgres and passes it to every task in `TEST_POSTGRES_SERVER` (in turbo's `passThroughEnv`, so it doesn't change the cache key). It stops the server when turbo exits, however turbo exits.
3. **A package keeps to its own databases.** Each package's global setup copies a template of its own (`test_template_<package>`) from an empty database that the roles script has set up, migrates it, and names its test databases `test_db_<package>_…`. Its teardown fails the run when one of those is left behind and drops the template, so a package can't trip over another's leftovers on the shared server.
4. **A package run alone still works.** Without `TEST_POSTGRES_SERVER` (`pnpm --filter <pkg> test:integration`), the global setup starts and stops a server of its own, as before.
5. **PGlite is gone.** No package used it any more, so `@repo/testing/pglite` (`createDatabaseTest`) and the `@electric-sql/pglite` dependencies are removed.

## The measurements

Measured on 2026-10-25 on an Apple M2 Pro (12 cores) with Docker 29.8.2 (8 GB for containers), with Docker already running. Each figure is the median of 3 runs, wall clock, container start included.

| Run                                                                  | PGlite                   | Real Postgres            | Change |
| -------------------------------------------------------------------- | ------------------------ | ------------------------ | ------ |
| `pnpm --filter @repo/auth test:integration` (111 tests)              | 11.92 s (11.75 to 13.75) | 7.56 s (7.54 to 7.66)    | −37%   |
| root `pnpm test:integration --force` (10 turbo tasks, custodian too) | 29.26 s (26.10 to 29.94) | 15.90 s (14.36 to 16.41) | −46%   |

The rule allowed up to 15.5 s for `@repo/auth`. Its real-Postgres runs used #154's harness as it was, with no tuning: only the tests' import and the package's global setup changed. The likely reason it got faster: PGlite migrates its template in every Vitest worker, in single-threaded WebAssembly, while the real server migrates once per package and copies the template per test natively. The root run's "after" figure also includes `@repo/testing`'s two new harness tests, so if anything it understates the gain.

## What PGlite couldn't test

The three gaps #83 listed, each of which the real server closes:

1. **The production driver.** The app uses postgres.js; PGlite's tests used `drizzle-orm/pglite`, which parses results its own way.
2. **The real roles and logins.** On PGlite, `app` existed only if a test created it by hand, and was reached with `set role`, never a password login with `01-roles.sh`'s grants.
3. **Concurrency.** PGlite is one connection, so races between requests, row locks and `SKIP LOCKED` couldn't be tested.

## What moving found

Every test kept its behavior. Three things changed, and each was something PGlite had hidden:

- **The driver's result shape.** postgres.js's `execute` returns the rows as an array, where PGlite's returned `{ rows }`. Three tests read `rows` and now read the array.
- **The real grants.** `app` can't read the `drizzle` schema or create tables, as in production, so the migrations tests now sign in as `migratorOrm`.
- **Work that outlived its test.** Some auth tests sent sign-in requests and never waited for the background work after the response ([ADR 0006](0006-sign-in-email-sent-after-the-response.md)). On a real server that work then ran on a closed connection (`CONNECTION_ENDED`). `authTest` in `@repo/auth`'s `testing.ts` now waits for it (`settle`) before the test's connections close.

No difference in how `bigint`, `numeric` or timestamps are parsed showed up.

## Why

- **It tests what runs in production.** The same server version and image, the same roles and grants from the same script, password logins, the same driver, and several connections at once. #42's row-level security and #56's pg-boss jobs need all of these.
- **It is faster.** See the measurements above.
- **The root run already needed Docker.** The custodian's tests have needed it since #80, and so has every `@repo/db` integration run since #154. PGlite only spared Docker when running one other package's integration tests on their own.
- **One server, not one per package.** Four packages starting a container each would mean four Postgres servers at once and four container starts per root run.

## Considered options

- **Keep PGlite as the default** and use the real server only where a test needs it. That's what #154 did, but it means two harnesses, two sets of rules in CLAUDE.md, and tests that pass on one server and not on the other.
- **Testcontainers' reuse mode** (`withReuse()`) instead of a wrapper. Testcontainers' reaper doesn't remove reused containers, so one would stay up with fixed passwords on a published port, and two packages starting at once could race to create it.
- **One root Vitest run across every package.** It would give one server without a wrapper, but it gives up turbo's per-package tasks and their cache.
- **A database per worker** instead of per test, with tables emptied between tests (as e2e does). Copying a template per test is quick enough, and keeps every test's database untouched by any other.

## Consequences

- Every TypeScript integration run needs Docker, including one package run on its own.
- When turbo finds every task in its cache, the root run still starts the server for nothing (about 1.5 seconds).
- Postgres runs with `max_connections=500`, since several packages' workers, each test with its own pools, share one server.
- One test starts a second TypeScript-side server during the root run, on purpose: `with-postgres.ts`'s own test, which checks that the runner starts and stops one.
- Ctrl-C reaches turbo directly, and the runner doesn't pass it on a second time, which could make turbo kill its tasks before they drop their databases. Turbo exits 0 when interrupted, so an interrupted root run does too.
- A new package with integration tests adds the same `postgres-setup.ts` and `vitest.config.ts` lines as the others.
