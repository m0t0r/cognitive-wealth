# apps/web-e2e

Each run starts a throwaway Postgres (Testcontainers, the image pinned in `compose.yaml`; needs Docker) and migrates a template DB. Each Playwright worker gets its own `CREATE DATABASE … TEMPLATE` copy and its own standalone server, which `baseURL` points at.

- The auto `db` fixture (Drizzle) truncates every table before each test: seed per test through it, never in shared setup.
- Specs must import `test`/`expect` from `fixtures.ts` (lint-enforced).
- Seed with `support/seed.ts` (`uniqueEmail(testInfo, …)` for every address, since workers share Mailpit).
- Sign in with `signIn(email)` (HTTP harness, from the test's unique `clientIp`) or through the UI with `support/sign-in.ts` and `mailbox`, and give a second user `openBrowser()` (its own context and `clientIp`).
- Routes live in `support/routes.ts` as `PUBLIC_ROUTES` and `SIGNED_IN_ROUTES` (each with a `setUp` seed that the a11y and security-header specs sign in for).
