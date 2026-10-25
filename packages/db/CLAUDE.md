# packages/db

- Files Node runs directly (`migrate.ts`, `cli/*` and what they import statically) keep `.ts` import extensions; files the app bundles don't, even when a CLI loads them too (`src/schema/`, `@repo/households`' `seed.ts` and `world.ts`).
- `src/schema/` is bundler-style, so a Node entry that needs it calls `registerTsResolution()` (`src/cli/ts-resolution.ts`) and then `await import()`s it.
- Better Auth's tables (`schema/auth.ts`, `schema/organization.ts`) keep Better Auth's names. Tables Cognitive Wealth owns use `GLOSSARY.md`'s, so a domain table's Firm column is `firm_id`, referencing `organization.id`.
- Follow the `drizzle` skill: tables in `src/schema/` (one file per family, `_helpers.ts` timestamps), no serial/composite PKs, `db.select()` builders only (no `db.query`).
- Migrations live in `migrations/` and run as the `migrator` role; the app connects as `app` (DML only), both created by `docker/initdb/01-roles.sh`.
