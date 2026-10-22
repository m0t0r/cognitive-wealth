import { randomBytes } from "node:crypto";
import { cp } from "node:fs/promises";
import { join } from "node:path";
import { runMigrations } from "@repo/db/migrator";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import {
  ROLES_SCRIPT,
  TEMPLATE_DATABASE,
  composePostgresImage,
  databaseUrl,
} from "./support/database";
import { STANDALONE, WEB } from "./support/server";

// Testcontainers' reaper, pinned by digest like every other image (its default is tag-only).
const RYUK_IMAGE =
  "testcontainers/ryuk:0.14.0@sha256:7c1a8a9a47c780ed0f983770a662f80deb115d95cce3e2daa3d12115b8cd28f0";

/**
 * Once per run: lay out the standalone server like the Docker image does, start a throwaway
 * Postgres with the production roles, and migrate the template database that every worker copies.
 */
export default async function globalSetup() {
  await cp(join(WEB, ".next/static"), join(STANDALONE, ".next/static"), { recursive: true });
  await cp(join(WEB, "public"), join(STANDALONE, "public"), { recursive: true });

  // Random credentials for every role: Testcontainers defaults the superuser to test/test, and
  // Docker can publish the container's port on every host interface.
  const passwords = {
    superuser: randomBytes(24).toString("hex"),
    migrator: randomBytes(24).toString("hex"),
    app: randomBytes(24).toString("hex"),
  };
  process.env.RYUK_CONTAINER_IMAGE ??= RYUK_IMAGE;

  const container = await new PostgreSqlContainer(composePostgresImage())
    .withDatabase(TEMPLATE_DATABASE)
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
    .start();

  const serverUrl = container.getConnectionUri();
  // Migrate as `migrator`, as the compose `migrate` job does, so tables get its default grants.
  await runMigrations({
    url: databaseUrl(serverUrl, TEMPLATE_DATABASE, {
      name: "migrator",
      password: passwords.migrator,
    }),
  });

  // Workers inherit the environment that global setup leaves behind.
  process.env.PLAYWRIGHT_DATABASE_URL = serverUrl;
  process.env.PLAYWRIGHT_DATABASE_APP_PASSWORD = passwords.app;

  return async () => {
    await container.stop();
  };
}
