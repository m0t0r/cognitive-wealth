import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import { inject, test } from "vitest";
import type { TestProject } from "vitest/node";
import { REPO_ROOT, composeImage } from "./compose";

/**
 * A real Postgres for tests that PGlite can't run: password logins as the production roles,
 * several connections, the app's postgres.js driver. One container per Vitest run (global setup),
 * migrated once into a template; each test gets its own copy, dropped afterwards.
 */

// Testcontainers' reaper, pinned by digest like every other image (its default is tag-only).
const RYUK_IMAGE =
  "testcontainers/ryuk:0.14.0@sha256:7c1a8a9a47c780ed0f983770a662f80deb115d95cce3e2daa3d12115b8cd28f0";

/**
 * Pins Testcontainers' reaper image, unless the environment already names one. Call it before a
 * run's first container starts: the reaper starts with that one, whichever it is.
 */
export function pinReaperImage() {
  process.env.RYUK_CONTAINER_IMAGE ??= RYUK_IMAGE;
}

/** The role setup `compose.yaml` runs, so tests exercise the production grants. */
const ROLES_SCRIPT = join(REPO_ROOT, "packages/db/docker/initdb/01-roles.sh");

/** The container's own database: the roles script sets it up, global setup migrates it. */
const TEMPLATE_DATABASE = "test_template";

/** Every test database's prefix, so the run's teardown can find any that weren't dropped. */
const TEST_DATABASE_PREFIX = "test_db_";

export type Role = "app" | "migrator";

export type PostgresPasswords = { superuser: string; migrator: string; app: string };

/** What global setup hands to the workers (`provide`/`inject`). */
export type PostgresServer = { url: string; passwords: PostgresPasswords };

declare module "vitest" {
  interface ProvidedContext {
    postgresServer: PostgresServer;
  }
}

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
      // Disposable data: keep it in memory and skip durability work.
      .withTmpFs({ "/var/lib/postgresql": "rw" })
      .withCommand(["postgres", "-c", "fsync=off", "-c", "synchronous_commit=off"])
      .start()
  );
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

type PostgresGlobalSetupArgs = {
  /** Migrates the database at `url` (signed in as `migrator`) to the latest schema. */
  migrate: (url: string) => Promise<void>;
};

/**
 * A Vitest global setup (a file's default export, named in `globalSetup`) that starts the run's
 * Postgres and migrates the template. Its teardown fails the run when a test database is left
 * over, so a fixture that stops dropping them can't go unnoticed.
 */
export function postgresGlobalSetup({ migrate }: PostgresGlobalSetupArgs) {
  return async (project: TestProject) => {
    const passwords = newPasswords();
    const container = await startPostgres({ passwords, database: TEMPLATE_DATABASE });
    const url = container.getConnectionUri();
    try {
      // As `migrator`, like Compose's `migrate` job, so tables get its default grants to `app`.
      await migrate(
        databaseUrl({
          serverUrl: url,
          database: TEMPLATE_DATABASE,
          user: { name: "migrator", password: passwords.migrator },
        }),
      );
    } catch (error) {
      await container.stop();
      throw error;
    }
    project.provide("postgresServer", { url, passwords });

    return async () => {
      const admin = adminClient(url);
      try {
        const leftovers = await admin<{ datname: string }[]>`
          select datname from pg_database where starts_with(datname, ${TEST_DATABASE_PREFIX})`;
        if (leftovers.length > 0) {
          throw new Error(
            `Test databases were not dropped: ${leftovers.map((row) => row.datname).join(", ")}`,
          );
        }
      } finally {
        await admin.end();
        await container.stop();
      }
    };
  };
}

/** One test's own database: its name, and a URL that signs in as `role` with its password. */
export type TestDatabase = { name: string; url: (role: Role) => string };

/**
 * A `test` with a `database` fixture: a fresh copy of the migrated template on the run's Postgres
 * (see `postgresGlobalSetup`), dropped after the test whatever its outcome.
 */
export function createPostgresTest() {
  return test
    .extend(
      "postgresServer",
      { scope: "worker" },
      // Vitest requires a destructuring pattern as the fixture's first argument.
      // oxlint-disable-next-line no-empty-pattern
      ({}) => inject("postgresServer"),
    )
    .extend("postgresAdmin", { scope: "worker" }, async ({ postgresServer }, { onCleanup }) => {
      const admin = adminClient(postgresServer.url);
      onCleanup(() => admin.end());
      return admin;
    })
    .extend(
      "database",
      async ({ postgresServer, postgresAdmin }, { onCleanup }): Promise<TestDatabase> => {
        const name = `${TEST_DATABASE_PREFIX}${randomUUID().replaceAll("-", "")}`;
        await createDatabase(postgresAdmin, { name, template: TEMPLATE_DATABASE });
        onCleanup(() => dropDatabase(postgresAdmin, { name }));
        return {
          name,
          url: (role) =>
            databaseUrl({
              serverUrl: postgresServer.url,
              database: name,
              user: { name: role, password: postgresServer.passwords[role] },
            }),
        };
      },
    );
}
