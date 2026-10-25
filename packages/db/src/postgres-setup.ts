// The integration project's global setup (vitest.config.ts): starts the run's Postgres for
// `test` (`./testing`) and migrates its template with the real migrations, as `migrator`.
import { postgresGlobalSetup } from "@repo/testing/postgres";
import { runMigrations } from "./migrator";

export default postgresGlobalSetup({ migrate: (url) => runMigrations({ url }) });
