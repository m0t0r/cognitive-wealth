import { migrate } from "drizzle-orm/postgres-js/migrator";
import { type ConnectionConfig, connect } from "./connect.ts";
import { migrationsFolder } from "./migrations-folder.ts";

/** Applies pending migrations over a single dedicated connection, then closes it. */
export async function runMigrations(config: ConnectionConfig) {
  const { db, close } = connect(config, { max: 1 });
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await close();
  }
}
