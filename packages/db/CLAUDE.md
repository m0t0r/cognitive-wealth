# packages/db

- Files Node runs directly (`migrate.ts`, `seed.ts`, `cli/*` and what they import) keep `.ts` import extensions; files the app bundles don't.
- `src/schema/` is bundler-style, so a Node entry that needs it calls `registerTsResolution()` (`src/cli/ts-resolution.ts`) and then `await import()`s it.
- Follow the `drizzle` skill: tables in `src/schema/` (one file per family, `_helpers.ts` timestamps), no serial/composite PKs, `db.select()` builders only (no `db.query`).
- Migrations live in `migrations/` and run as the `migrator` role; the app connects as `app` (DML only), both created by `docker/initdb/01-roles.sh`.
