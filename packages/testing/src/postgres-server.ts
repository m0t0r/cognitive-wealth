// A real Postgres for tests, without Vitest: the root `pnpm test:integration` runner
// (`cli/with-postgres.ts`) starts it under plain Node, so relative imports keep their `.ts`
// extension. `./postgres` builds Vitest's global setup and fixtures on it.
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import { REPO_ROOT, composeImage } from "./compose.ts";
import { pinReaperImage } from "./reaper.ts";

/** The role setup `compose.yaml` runs, so tests exercise the production grants. */
const ROLES_SCRIPT = join(REPO_ROOT, "packages/db/docker/initdb/01-roles.sh");

/**
 * The database the roles script sets up on a server `startPostgresServer` starts, left empty:
 * each package's template is copied from it, since the script's grants and `migrator`'s default
 * privileges belong to a database, and `template1` has neither.
 */
export const BASE_DATABASE = "test_base";

/**
 * Names the shared server (a `PostgresServer` as JSON) that the root `pnpm test:integration`
 * starts for every package's run. Unset, each package's run starts a server of its own.
 */
export const SHARED_POSTGRES_ENV = "TEST_POSTGRES_SERVER";

export type Role = "app" | "migrator";

export type PostgresPasswords = { superuser: string; migrator: string; app: string };

/** A running server: its superuser URL and each role's password. */
export type PostgresServer = { url: string; passwords: PostgresPasswords };

/** A random password: Testcontainers defaults to test/test, and Docker may publish the port. */
export const secret = () => randomBytes(24).toString("hex");

export const newPasswords = (): PostgresPasswords => ({
  superuser: secret(),
  migrator: secret(),
  app: secret(),
});

/**
 * Starts compose.yaml's Postgres image with the production roles (`ROLES_SCRIPT`, scram-sha-256
 * passwords) and its data in memory. `database` is the one the roles script sets up.
 */
export async function startPostgres({
  passwords,
  database,
}: {
  passwords: PostgresPasswords;
  database: string;
}): Promise<StartedPostgreSqlContainer> {
  pinReaperImage();
  return (
    new PostgreSqlContainer(composeImage("postgres"))
      .withDatabase(database)
      .withUsername("postgres")
      .withPassword(passwords.superuser)
      .withEnvironment({
        POSTGRES_INITDB_ARGS: "--auth-local=scram-sha-256 --auth-host=scram-sha-256",
      })
      .withCopyFilesToContainer([
        { source: ROLES_SCRIPT, target: "/docker-entrypoint-initdb.d/01-roles.sh", mode: 0o755 },
      ])
      .withCopyContentToContainer([
        { content: passwords.migrator, target: "/run/secrets/db_migrator_password", mode: 0o444 },
        { content: passwords.app, target: "/run/secrets/db_app_password", mode: 0o444 },
      ])
      // Disposable data: keep it in memory and skip durability work. Several packages' workers
      // share one server in the root run, each test with its own pools, so allow more connections
      // than the default 100.
      .withTmpFs({ "/var/lib/postgresql": "rw" })
      .withCommand([
        "postgres",
        "-c",
        "fsync=off",
        "-c",
        "synchronous_commit=off",
        "-c",
        "max_connections=500",
      ])
      .start()
  );
}

/** A server for tests' templates (copied from `BASE_DATABASE`), and how to stop it. */
export async function startPostgresServer(): Promise<{
  server: PostgresServer;
  stop: () => Promise<void>;
}> {
  const passwords = newPasswords();
  const container = await startPostgres({ passwords, database: BASE_DATABASE });
  return {
    server: { url: container.getConnectionUri(), passwords },
    stop: async () => {
      await container.stop();
    },
  };
}

/** The shared server SHARED_POSTGRES_ENV names, or `undefined` when it's unset. */
export function sharedPostgresServer(): PostgresServer | undefined {
  const value = process.env[SHARED_POSTGRES_ENV];
  if (value === undefined || value === "") return undefined;
  // Written by `cli/with-postgres.ts`, from a PostgresServer.
  const server: PostgresServer = JSON.parse(value);
  return server;
}

/** A URL for `database` on the server at `serverUrl`: the superuser's, or `user`'s. */
export function databaseUrl({
  serverUrl,
  database,
  user,
}: {
  serverUrl: string;
  database: string;
  user?: { name: string; password: string };
}): string {
  const url = new URL(serverUrl);
  url.pathname = `/${database}`;
  if (user) {
    url.username = user.name;
    url.password = user.password;
  }
  return url.toString();
}

/**
 * Copies `template` into a new database owned by `migrator`, with the production database-level
 * grants (a template copies its tables and their grants, not who may connect).
 */
export async function createDatabase(
  admin: postgres.Sql,
  { name, template }: { name: string; template: string },
) {
  await admin.unsafe(`create database "${name}" owner migrator template "${template}"`);
  await admin.unsafe(`revoke all on database "${name}" from public`);
  await admin.unsafe(`grant connect on database "${name}" to app`);
}

export async function dropDatabase(admin: postgres.Sql, { name }: { name: string }) {
  await admin.unsafe(`drop database if exists "${name}" with (force)`);
}

/** A superuser connection to the server's maintenance database, for create and drop. */
export const adminClient = (serverUrl: string) =>
  postgres(databaseUrl({ serverUrl, database: "postgres" }), { max: 1, onnotice: () => {} });
