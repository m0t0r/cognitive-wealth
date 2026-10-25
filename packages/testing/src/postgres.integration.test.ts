import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import type { ProvidedContext } from "vitest";
import {
  type PackageDatabases,
  type SetupProject,
  SHARED_POSTGRES_ENV,
  adminClient,
  databaseUrl,
  postgresGlobalSetup,
  sharedPostgresServer,
  startPostgresServer,
} from "./postgres";

// The root `pnpm test:integration` runs every package's global setup on one shared server (named
// in SHARED_POSTGRES_ENV). Two fake packages, `@repo/a` and `@repo/b`, share one here.

/** A stand-in for Vitest's TestProject: the package's root and what it provides to workers. */
async function fakeProject(name: string) {
  const root = await mkdtemp(join(tmpdir(), "postgres-setup-"));
  await writeFile(join(root, "package.json"), JSON.stringify({ name }));
  const provided: Partial<ProvidedContext> = {};
  const project: SetupProject = {
    config: { root },
    provide: (key, value) => {
      provided[key] = value;
    },
  };
  return { project, provided, remove: () => rm(root, { recursive: true }) };
}

/** Runs `name`'s global setup, whose migration creates a table named after the package. */
async function setUpPackage({ name, table }: { name: string; table: string }) {
  const fake = await fakeProject(name);
  const setup = postgresGlobalSetup({
    migrate: async (url) => {
      const sql = postgres(url, { max: 1, onnotice: () => {} });
      await sql.unsafe(`create table ${table} (id int)`);
      await sql.end();
    },
  });
  const teardown = await setup(fake.project);
  await fake.remove();
  return { server: fake.provided.postgresServer!, teardown };
}

async function tablesIn(server: PackageDatabases, database: string) {
  const sql = postgres(
    databaseUrl({
      serverUrl: server.url,
      database,
      user: { name: "migrator", password: server.passwords.migrator },
    }),
    { max: 1 },
  );
  const rows = await sql<{ tablename: string }[]>`
    select tablename from pg_tables where schemaname = 'public' order by tablename`;
  await sql.end();
  return rows.map((row) => row.tablename);
}

describe("postgresGlobalSetup on a shared server", () => {
  let shared: Awaited<ReturnType<typeof startPostgresServer>>;

  beforeAll(async () => {
    // The root run's shared server when there is one, or one of this file's own.
    const running = sharedPostgresServer();
    shared = running ? { server: running, stop: async () => {} } : await startPostgresServer();
  }, 60_000);
  afterAll(() => shared?.stop());
  beforeEach(() => {
    vi.stubEnv(SHARED_POSTGRES_ENV, JSON.stringify(shared.server));
  });

  test("gives each package a template of its own, migrated by it alone", async () => {
    const a = await setUpPackage({ name: "@repo/a", table: "a_only" });
    const b = await setUpPackage({ name: "@repo/b", table: "b_only" });
    try {
      expect(a.server.url).toBe(shared.server.url);
      expect(b.server.url).toBe(shared.server.url);
      expect(a.server.template).not.toBe(b.server.template);
      expect(await tablesIn(a.server, a.server.template)).toEqual(["a_only"]);
      expect(await tablesIn(b.server, b.server.template)).toEqual(["b_only"]);
    } finally {
      await a.teardown();
      await b.teardown();
    }
  });

  test("teardown drops the package's template and leaves the server running", async () => {
    const a = await setUpPackage({ name: "@repo/a", table: "a_only" });
    await a.teardown();

    const admin = adminClient(shared.server.url);
    try {
      const templates = await admin`
        select datname from pg_database where datname = ${a.server.template}`;
      expect(templates).toEqual([]);
    } finally {
      await admin.end();
    }
  });

  test("a database left behind fails only its own package's teardown", async () => {
    const a = await setUpPackage({ name: "@repo/a", table: "a_only" });
    const b = await setUpPackage({ name: "@repo/b", table: "b_only" });
    const leftover = `${a.server.databasePrefix}leftover`;
    const admin = adminClient(shared.server.url);
    try {
      await admin.unsafe(`create database "${leftover}"`);

      await expect(a.teardown()).rejects.toThrow(`Test databases were not dropped: ${leftover}`);
      await expect(b.teardown()).resolves.toBeUndefined();
    } finally {
      await admin.unsafe(`drop database if exists "${leftover}"`);
      await admin.end();
    }
  });
});
