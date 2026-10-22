// Applies pending migrations. Runs directly under Node's type stripping (`node src/migrate.ts`),
// so relative imports keep their `.ts` extension.
import { connectionConfig } from "./config.ts";
import { runMigrations } from "./migrator.ts";

await runMigrations(connectionConfig());
