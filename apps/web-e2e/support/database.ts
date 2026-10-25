import { connect } from "@repo/db/connect";
import { adminClient, createDatabase, databaseUrl, dropDatabase } from "@repo/testing/postgres";
import { requiredEnv } from "./compose";

/** Migrated once per run by global setup; every worker database is a copy of it. */
export const TEMPLATE_DATABASE = "e2e_template";

const SAFE_NAME = /^[a-z0-9_]+$/;

// Empties every table the migrations created. The journal lives in the `drizzle` schema and stays.
const TRUNCATE_ALL = `
  do $$
  declare tables text;
  begin
    select string_agg(format('%I.%I', schemaname, tablename), ', ') into tables
    from pg_tables where schemaname = 'public';
    if tables is not null then
      execute 'truncate ' || tables || ' restart identity cascade';
    end if;
  end $$`;

function assertSafeName(name: string) {
  if (!SAFE_NAME.test(name)) throw new Error(`Unsafe database name: ${name}`);
}

async function admin(run: (client: ReturnType<typeof adminClient>) => Promise<void>) {
  const client = adminClient(requiredEnv("PLAYWRIGHT_DATABASE_URL"));
  try {
    await run(client);
  } finally {
    await client.end();
  }
}

/**
 * Copies the migrated template into a new database owned by `migrator`, with the same
 * database-level grants as production (those aren't copied from a template).
 */
export async function createWorkerDatabase(name: string) {
  assertSafeName(name);
  await admin((client) => createDatabase(client, { name, template: TEMPLATE_DATABASE }));

  const serverUrl = requiredEnv("PLAYWRIGHT_DATABASE_URL");
  // Seeding and resets run as the superuser; the app itself connects as the DML-only `app` role.
  const connection = connect({ url: databaseUrl({ serverUrl, database: name }) }, { max: 1 });
  return {
    db: connection.db,
    appUrl: databaseUrl({
      serverUrl,
      database: name,
      user: {
        name: "app",
        password: requiredEnv("PLAYWRIGHT_DATABASE_APP_PASSWORD"),
      },
    }),
    truncateAll: () => connection.client.unsafe(TRUNCATE_ALL),
    dispose: async () => {
      await connection.close();
      await admin((client) => dropDatabase(client, { name }));
    },
  };
}
