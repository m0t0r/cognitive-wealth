import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect } from "@repo/db/connect";

/** Migrated once per run by global setup; every worker database is a copy of it. */
export const TEMPLATE_DATABASE = "e2e_template";

/** The same role setup `compose.yaml` runs, so e2e exercises the production grants. */
export const ROLES_SCRIPT = join(
  import.meta.dirname,
  "../../../packages/db/docker/initdb/01-roles.sh",
);

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

/** The Postgres image `compose.yaml` pins, so e2e runs against exactly what the stack runs. */
export function composePostgresImage(): string {
  const compose = readFileSync(join(import.meta.dirname, "../../../compose.yaml"), "utf8");
  const image = /^\s*image:\s*(postgres:\S+)\s*$/m.exec(compose)?.[1];
  if (!image) throw new Error("compose.yaml has no postgres image");
  return image;
}

function requiredEnv(name: "PLAYWRIGHT_DATABASE_URL" | "PLAYWRIGHT_DATABASE_APP_PASSWORD") {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; did global-setup.ts run?`);
  return value;
}

/** A URL for `database` on the run's Postgres: the superuser's (from global setup) or `user`'s. */
export function databaseUrl(
  serverUrl: string,
  database: string,
  user?: { name: string; password: string },
): string {
  const url = new URL(serverUrl);
  url.pathname = `/${database}`;
  if (user) {
    url.username = user.name;
    url.password = user.password;
  }
  return url.toString();
}

function assertSafeName(name: string) {
  if (!SAFE_NAME.test(name)) throw new Error(`Unsafe database name: ${name}`);
}

async function admin(...statements: string[]) {
  const url = databaseUrl(requiredEnv("PLAYWRIGHT_DATABASE_URL"), "postgres");
  const { client, close } = connect({ url }, { max: 1 });
  try {
    for (const statement of statements) {
      // Sequential on purpose: each statement depends on the one before it.
      // oxlint-disable-next-line no-await-in-loop
      await client.unsafe(statement);
    }
  } finally {
    await close();
  }
}

/**
 * Copies the migrated template into a new database owned by `migrator`, with the same
 * database-level grants as production (those aren't copied from a template).
 */
export async function createWorkerDatabase(name: string) {
  assertSafeName(name);
  await admin(
    `create database "${name}" owner migrator template "${TEMPLATE_DATABASE}"`,
    `revoke all on database "${name}" from public`,
    `grant connect on database "${name}" to app`,
  );

  const serverUrl = requiredEnv("PLAYWRIGHT_DATABASE_URL");
  // Seeding and resets run as the superuser; the app itself connects as the DML-only `app` role.
  const connection = connect({ url: databaseUrl(serverUrl, name) }, { max: 1 });
  return {
    db: connection.db,
    appUrl: databaseUrl(serverUrl, name, {
      name: "app",
      password: requiredEnv("PLAYWRIGHT_DATABASE_APP_PASSWORD"),
    }),
    truncateAll: () => connection.client.unsafe(TRUNCATE_ALL),
    dispose: async () => {
      await connection.close();
      await admin(`drop database if exists "${name}" with (force)`);
    },
  };
}
