// The integration project's global setup (vitest.config.ts): `@repo/db`'s, which starts the run's
// Postgres (or joins the root run's) and migrates this package's template for `@repo/db/testing`.
export { default } from "@repo/db/postgres-setup";
