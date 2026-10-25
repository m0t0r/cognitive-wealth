import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { inject, test } from "vitest";
import type { TestProject } from "vitest/node";
import {
  BASE_DATABASE,
  type PostgresServer,
  type Role,
  adminClient,
  createDatabase,
  databaseUrl,
  dropDatabase,
  sharedPostgresServer,
  startPostgresServer,
} from "./postgres-server.ts";

/**
 * A real Postgres for integration tests: password logins as the production roles, several
 * connections, the app's postgres.js driver. A package's global setup migrates a template of its
 * own once, on the shared server the root `pnpm test:integration` starts or, run on its own, on
 * a server it starts itself; each test gets its own copy of that template, dropped afterwards.
 */

export {
  type PostgresPasswords,
  type PostgresServer,
  type Role,
  SHARED_POSTGRES_ENV,
  adminClient,
  createDatabase,
  databaseUrl,
  dropDatabase,
  newPasswords,
  secret,
  sharedPostgresServer,
  startPostgres,
  startPostgresServer,
} from "./postgres-server.ts";

/** The server, plus the package's own template and its test databases' name prefix. */
export type PackageDatabases = PostgresServer & { template: string; databasePrefix: string };

declare module "vitest" {
  interface ProvidedContext {
    postgresServer: PackageDatabases;
  }
}

/** `test_db_<key>_` and a 32-character id must fit Postgres's 63-byte identifiers. */
const MAX_PACKAGE_KEY = 22;

/**
 * `@repo/auth` → `repo_auth`: names the package's template and prefixes its test databases, so
 * packages sharing a server can't touch each other's (the leftover check finds only its own).
 * Never shortened, since two shortened names could collide.
 */
function packageKey(name: string): string {
  const key = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "");
  if (key.length > MAX_PACKAGE_KEY) {
    throw new Error(
      `Package name ${name} is too long for its test databases' names (at most ${MAX_PACKAGE_KEY} characters as ${key})`,
    );
  }
  return key;
}

async function packageName(root: string): Promise<string> {
  const { name }: { name: string } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  return name;
}

type PostgresGlobalSetupArgs = {
  /** Migrates the database at `url` (signed in as `migrator`) to the latest schema. */
  migrate: (url: string) => Promise<void>;
};

/** What the setup uses of Vitest's TestProject: the package's root, and `provide`. */
export type SetupProject = {
  config: Pick<TestProject["config"], "root">;
  provide: TestProject["provide"];
};

/**
 * A Vitest global setup (a file's default export, named in `globalSetup`) that migrates the
 * package's template on the run's Postgres: the shared one in SHARED_POSTGRES_ENV, or one it
 * starts and stops itself. Its teardown fails the run when one of the package's test databases is
 * left over, so a fixture that stops dropping them can't go unnoticed, and drops the template.
 */
export function postgresGlobalSetup({ migrate }: PostgresGlobalSetupArgs) {
  return async (project: SetupProject) => {
    const key = packageKey(await packageName(project.config.root));
    const template = `test_template_${key}`;
    const databasePrefix = `test_db_${key}_`;

    const shared = sharedPostgresServer();
    const own = shared ? undefined : await startPostgresServer();
    const server = shared ?? own!.server;
    const admin = adminClient(server.url);

    const teardown = async () => {
      try {
        const leftovers = await admin<{ datname: string }[]>`
          select datname from pg_database where starts_with(datname, ${databasePrefix})`;
        if (leftovers.length > 0) {
          throw new Error(
            `Test databases were not dropped: ${leftovers.map((row) => row.datname).join(", ")}`,
          );
        }
      } finally {
        await dropDatabase(admin, { name: template });
        await admin.end();
        await own?.stop();
      }
    };

    try {
      // A run that was killed may have left this package's template on a shared server.
      await dropDatabase(admin, { name: template });
      await createDatabase(admin, { name: template, template: BASE_DATABASE });
      // As `migrator`, like Compose's `migrate` job, so tables get its default grants to `app`.
      await migrate(
        databaseUrl({
          serverUrl: server.url,
          database: template,
          user: { name: "migrator", password: server.passwords.migrator },
        }),
      );
    } catch (error) {
      await teardown().catch(() => {});
      throw error;
    }
    project.provide("postgresServer", { ...server, template, databasePrefix });
    return teardown;
  };
}

/** One test's own database: its name, and a URL that signs in as `role` with its password. */
export type TestDatabase = { name: string; url: (role: Role) => string };

/**
 * A `test` with a `database` fixture: a fresh copy of the package's migrated template (see
 * `postgresGlobalSetup`), dropped after the test whatever its outcome.
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
        const name = `${postgresServer.databasePrefix}${randomUUID().replaceAll("-", "")}`;
        await createDatabase(postgresAdmin, { name, template: postgresServer.template });
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
