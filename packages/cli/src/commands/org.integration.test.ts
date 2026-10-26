// One representative run of each `cw org` command on a real database: the dry run, the change,
// the refusal, the undo. `@repo/db`'s tests own the rules (org-create, org-status, records-export).
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { count, eq } from "drizzle-orm";
import { createOrganization } from "@repo/db/cli/organizations";
import { auditEvent, organization } from "@repo/db/schema";
import { test } from "@repo/db/testing";
import { createCli } from "../app";
import { dependencies, run } from "../testing";

const args = (command: string, ...rest: string[]) => [
  "org",
  command,
  "--slug",
  "acme",
  "--reason",
  "Contract ended",
  ...rest,
];

test("deactivates after a dry run, refuses twice, and reactivates", async ({ orm }) => {
  const created = await createOrganization(orm, {
    name: "Acme",
    slug: "acme",
    ownerEmail: "owner@acme.test",
  });
  const cli = createCli(
    dependencies({
      openDatabase: async () => ({ db: orm, close: async () => {}, target: "test", local: true }),
    }),
  );
  const deactivatedAt = async () =>
    (
      await orm
        .select({ at: organization.deactivatedAt })
        .from(organization)
        .where(eq(organization.slug, "acme"))
    )[0]?.at;

  const dryRun = await run({ cli, argv: args("deactivate", "--dry-run") });
  expect(dryRun).toMatchObject({
    exitCode: 0,
    output: {
      database: "test",
      publicId: created.publicId,
      slug: "acme",
      dryRun: true,
      cta: {
        commands: [{ command: "pnpm cw org deactivate --slug acme --reason 'Contract ended'" }],
      },
    },
  });
  expect(await deactivatedAt()).toBeNull();

  const deactivated = await run({ cli, argv: args("deactivate") });
  expect(deactivated.output).toMatchObject({ dryRun: false, canceledInvitations: 0 });
  expect(await deactivatedAt()).toEqual(new Date(String(deactivated.output.at)));

  const again = await run({ cli, argv: args("deactivate") });
  expect(again).toMatchObject({ exitCode: 1, output: { code: "already_deactivated" } });

  const reactivated = await run({ cli, argv: args("reactivate") });
  expect(reactivated).toMatchObject({ exitCode: 0, output: { dryRun: false } });
  expect(await deactivatedAt()).toBeNull();
});

describe("cw org create", () => {
  const create = ["org", "create", "--name", "Acme Corp", "--owner", "Owner@Acme.test"];

  test("creates after a dry run, suggests signing the owner in, and refuses a taken slug", async ({
    orm,
  }) => {
    const cli = createCli(
      dependencies({
        openDatabase: async () => ({ db: orm, close: async () => {}, target: "test", local: true }),
      }),
    );
    const organizations = async () => (await orm.select({ n: count() }).from(organization))[0]?.n;

    const dryRun = await run({ cli, argv: [...create, "--dry-run"] });
    expect(dryRun).toMatchObject({
      exitCode: 0,
      output: {
        database: "test",
        slug: "acme-corp",
        owner: { email: "owner@acme.test", created: true },
        dryRun: true,
        cta: {
          commands: [
            {
              command:
                "pnpm cw org create --name 'Acme Corp' --slug acme-corp --owner owner@acme.test",
            },
          ],
        },
      },
    });
    expect(await organizations()).toBe(0);

    const created = await run({ cli, argv: create });
    expect(created).toMatchObject({
      exitCode: 0,
      output: {
        name: "Acme Corp",
        slug: "acme-corp",
        dryRun: false,
        cta: { commands: [{ command: "pnpm cw dev sign-in owner@acme.test" }] },
      },
    });
    expect(await organizations()).toBe(1);

    const again = await run({ cli, argv: create });
    expect(again).toMatchObject({ exitCode: 1, output: { code: "slug_taken" } });
  });

  test("suggests no sign-in on a database that isn't local", async ({ orm }) => {
    const cli = createCli(
      dependencies({
        openDatabase: async () => ({
          db: orm,
          close: async () => {},
          target: "prod",
          local: false,
        }),
      }),
    );
    const { output, exitCode } = await run({ cli, argv: create });
    expect(exitCode).toBe(0);
    expect(output.cta).toBeUndefined();
  });
});

describe("cw org export", () => {
  test("reads as migrator, counts with --dry-run, then writes and audits", async ({
    migratorOrm,
  }) => {
    await createOrganization(migratorOrm, {
      name: "Acme",
      slug: "acme",
      ownerEmail: "o@acme.test",
    });
    const parent = await mkdtemp(join(tmpdir(), "cw-org-export-"));
    onTestFinished(() => rm(parent, { recursive: true, force: true }));
    const out = join(parent, "out");
    const openDatabase = vi.fn(async () => ({
      db: migratorOrm,
      close: async () => {},
      target: "test as migrator",
      local: true,
    }));
    const cli = createCli(dependencies({ openDatabase }));
    const argv = ["org", "export", "--slug", "acme", "--out", out, "--reason", "Firm's own"];
    const exports = async () =>
      (
        await migratorOrm
          .select({ n: count() })
          .from(auditEvent)
          .where(eq(auditEvent.action, "org.records_exported"))
      )[0]?.n;

    const dryRun = await run({ cli, argv: [...argv, "--dry-run"] });
    expect(dryRun).toMatchObject({
      exitCode: 0,
      output: { out, state: "active", manifestHash: null, warnings: [], dryRun: true },
    });
    expect(openDatabase).toHaveBeenCalledWith({ asMigrator: true });
    expect(await readdir(parent)).toEqual([]);

    const written = await run({ cli, argv });
    expect(written).toMatchObject({
      exitCode: 0,
      output: { database: "test as migrator", out, slug: "acme", warnings: [], dryRun: false },
    });
    expect(written.output.manifestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(written.output.tables).toEqual(dryRun.output.tables);
    expect(written.output.tables).toContainEqual({ table: "member", file: "member.csv", rows: 1 });
    expect(await exports()).toBe(1);

    const again = await run({ cli, argv });
    expect(again).toMatchObject({ exitCode: 1, output: { code: "out_not_empty" } });
  });

  test("warns when --out is inside the repository", async ({ migratorOrm }) => {
    await createOrganization(migratorOrm, {
      name: "Acme",
      slug: "acme",
      ownerEmail: "o@acme.test",
    });
    const cli = createCli(
      dependencies({
        openDatabase: async () => ({
          db: migratorOrm,
          close: async () => {},
          target: "t",
          local: true,
        }),
      }),
    );
    const out = join(import.meta.dirname, "never-written");
    const { output } = await run({
      cli,
      argv: ["org", "export", "--slug", "acme", "--out", out, "--reason", "x", "--dry-run"],
    });
    expect(output.warnings).toEqual([expect.stringMatching(/is inside the repository/)]);
  });
});
