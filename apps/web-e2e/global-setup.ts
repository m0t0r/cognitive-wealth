import { randomBytes } from "node:crypto";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "@repo/db/migrator";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { composeImage } from "./support/compose";
import { ROLES_SCRIPT, TEMPLATE_DATABASE, databaseUrl } from "./support/database";
import { startMailpit } from "./support/mailpit";
import { startRedis } from "./support/redis";
import { STANDALONE, WEB } from "./support/server";

// Testcontainers' reaper, pinned by digest like every other image (its default is tag-only).
const RYUK_IMAGE =
  "testcontainers/ryuk:0.14.0@sha256:7c1a8a9a47c780ed0f983770a662f80deb115d95cce3e2daa3d12115b8cd28f0";

const secret = () => randomBytes(24).toString("hex");

async function startPostgres(passwords: { superuser: string; migrator: string; app: string }) {
  return (
    new PostgreSqlContainer(composeImage("postgres"))
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
      .start()
  );
}

/**
 * Once per run: lay out the standalone server like the Docker image does, start a throwaway
 * Postgres with the production roles and migrate the template database that every worker copies,
 * and start Redis (compose.yaml's ACL) and Mailpit.
 */
export default async function globalSetup() {
  await cp(join(WEB, ".next/static"), join(STANDALONE, ".next/static"), { recursive: true });
  await cp(join(WEB, "public"), join(STANDALONE, "public"), { recursive: true });

  // Random credentials everywhere: Testcontainers defaults the superuser to test/test, and Docker
  // can publish the containers' ports on every host interface.
  const passwords = {
    superuser: secret(),
    migrator: secret(),
    app: secret(),
    redisApp: secret(),
    redisJanitor: secret(),
    mailpitUi: secret(),
  };
  process.env.RYUK_CONTAINER_IMAGE ??= RYUK_IMAGE;

  // The server reads the Redis password from a file, as in production (REDIS_PASSWORD_FILE).
  const secretsDir = await mkdtemp(join(tmpdir(), "cw-e2e-"));
  const redisPasswordFile = join(secretsDir, "redis_password");
  await writeFile(redisPasswordFile, passwords.redisApp, { mode: 0o600 });

  // If one fails, Testcontainers' reaper removes the others when this process exits.
  const [postgres, redis, mailpit] = await Promise.all([
    startPostgres(passwords),
    startRedis({ app: passwords.redisApp, janitor: passwords.redisJanitor }),
    startMailpit(passwords.mailpitUi),
  ]).catch(async (error: unknown) => {
    await rm(secretsDir, { recursive: true, force: true });
    throw error;
  });

  const serverUrl = postgres.getConnectionUri();
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
  process.env.PLAYWRIGHT_REDIS_URL = redis.url;
  process.env.PLAYWRIGHT_REDIS_PASSWORD_FILE = redisPasswordFile;
  process.env.PLAYWRIGHT_REDIS_JANITOR_PASSWORD = passwords.redisJanitor;
  process.env.PLAYWRIGHT_SMTP_URL = mailpit.smtpUrl;
  process.env.PLAYWRIGHT_MAILPIT_URL = mailpit.apiUrl;
  // Signs this run's sessions; a fresh one per run, so no cookie outlives it.
  process.env.PLAYWRIGHT_AUTH_SECRET = randomBytes(32).toString("hex");

  return async () => {
    await Promise.all([postgres.stop(), redis.stop(), mailpit.stop()]);
    await rm(secretsDir, { recursive: true, force: true });
  };
}
