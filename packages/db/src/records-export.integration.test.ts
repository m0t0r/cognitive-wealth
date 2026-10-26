// `exportRecords`, behind `cw org export` (#206): a Records export of one Firm, read as `migrator` in one snapshot, on two
// Firms with data, so a row of the other Firm in any file shows.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import { eq, getTableName, sql } from "drizzle-orm";
import { deactivateOrganization } from "./cli/organizations";
import { type Manifest, exportRecords } from "./cli/records-export";
import { seedFirm } from "./firm-test-data";
import type { Database } from "./index";
import { RECORD_TABLES } from "./records";
import { auditEvent, household, invitation, member, organization, user } from "./schema";
import { test as base } from "./testing";

const byNumber = (a: number, b: number) => a - b;
const RECORD_NAMES = RECORD_TABLES.map(({ table }) => getTableName(table));

const TRICKY = 'Reyes, "the elder"\nsecond line';
const METADATA = { note: "a, b", nested: { quote: '"q"', list: [1, 2] } };

/** A temporary parent folder per test, removed after it; `out` is a path inside it, not created. */
// oxlint-disable-next-line no-empty-pattern -- Vitest reads a fixture's dependencies from this pattern, and it has none
const test = base.extend("parent", async ({}, { onCleanup }) => {
  const dir = await mkdtemp(join(tmpdir(), "org-export-test-"));
  onCleanup(() => rm(dir, { recursive: true, force: true }));
  return dir;
});

type Seeded = { firmId: number; publicId: string; userIds: number[] };

/**
 * `seedFirm`'s rows for `slug`, plus a member, two past members (removal deletes a `member` row),
 * a User in no Firm, a Household named `TRICKY` and an audit event with `METADATA`.
 */
async function seedExportFirm(owner: Database, slug: string): Promise<Seeded> {
  const firmId = await seedFirm(owner, slug);
  const [current, joined, inviter] = await owner
    .insert(user)
    .values([
      { email: `current@${slug}.test`, name: `Current ${slug}`, emailVerified: true },
      // Joined by invitation, then was removed: found through their acceptance.
      { email: `joined@${slug}.test`, name: `Joined ${slug}`, emailVerified: true },
      // Was removed after inviting someone, never having acted otherwise: found through it.
      { email: `inviter@${slug}.test`, name: `Inviter ${slug}`, emailVerified: true },
      // In no Firm, so no export may name them.
      { email: `stranger@${slug}.test`, name: "Not in any Firm", emailVerified: true },
    ])
    .returning({ id: user.id });
  await owner.insert(member).values({ organizationId: firmId, userId: current!.id, role: "owner" });
  const expiresAt = new Date(Date.now() + 60_000);
  await owner.insert(invitation).values([
    {
      organizationId: firmId,
      email: `joined@${slug}.test`,
      role: "member",
      status: "accepted",
      inviterId: current!.id,
      expiresAt,
    },
    {
      organizationId: firmId,
      email: `invitee@${slug}.test`,
      role: "member",
      inviterId: inviter!.id,
      expiresAt,
    },
  ]);
  await owner.insert(auditEvent).values([
    { action: "org.invitation.accepted", actorUserId: joined!.id, organizationId: firmId },
    {
      action: "org.member.role_changed",
      actorUserId: current!.id,
      organizationId: firmId,
      metadata: METADATA,
    },
  ]);
  await owner.insert(household).values({ firmId, name: TRICKY, relationshipStatus: "prospect" });
  const [org] = await owner
    .select({ publicId: organization.publicId })
    .from(organization)
    .where(eq(organization.id, firmId));
  return { firmId, publicId: org!.publicId, userIds: [current!.id, joined!.id, inviter!.id] };
}

const readCsv = async (out: string, file: string): Promise<Record<string, string>[]> =>
  parse(await readFile(join(out, file)), { columns: true });

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

const exportEvents = (owner: Database) =>
  owner
    .select({
      actorUserId: auditEvent.actorUserId,
      organizationId: auditEvent.organizationId,
      targetType: auditEvent.targetType,
      targetId: auditEvent.targetId,
      metadata: auditEvent.metadata,
    })
    .from(auditEvent)
    .where(eq(auditEvent.action, "org.records_exported"));

describe("exportRecords", () => {
  test("writes one CSV per record table, manifest.json and README.md", async ({
    migratorOrm,
    parent,
  }) => {
    const acme = await seedExportFirm(migratorOrm, "acme");
    await seedExportFirm(migratorOrm, "globex");
    const out = join(parent, "acme-export");

    const result = await exportRecords(migratorOrm, {
      slug: "acme",
      out,
      reason: "SEC exam request of 2026-10-26",
    });

    expect((await readdir(out)).toSorted()).toEqual(
      [...RECORD_NAMES.map((table) => `${table}.csv`), "README.md", "manifest.json"].toSorted(),
    );
    const manifest: Manifest = JSON.parse(await readFile(join(out, "manifest.json"), "utf8"));
    expect(manifest).toMatchObject({
      version: 1,
      firm: { slug: "acme", publicId: acme.publicId, state: "active" },
    });
    expect(result).toMatchObject({ out, firmState: "active" });
    expect(manifest.files.map(({ table }) => table)).toEqual(RECORD_NAMES);
  });

  test("puts no row of another Firm in any file", async ({ migratorOrm, parent }) => {
    const acme = await seedExportFirm(migratorOrm, "acme");
    await seedExportFirm(migratorOrm, "globex");
    const out = join(parent, "out");

    await exportRecords(migratorOrm, { slug: "acme", out, reason: "Firm's own request" });

    const files = await Promise.all(
      RECORD_NAMES.map(async (table) => ({ table, rows: await readCsv(out, `${table}.csv`) })),
    );
    for (const { table, rows } of files) {
      for (const row of rows) {
        for (const column of ["firm_id", "organization_id"]) {
          if (column in row) expect(row[column], `${table}.${column}`).toBe(String(acme.firmId));
        }
      }
    }
    const csv = Object.fromEntries(files.map(({ table, rows }) => [table, rows]));
    expect(csv.organization?.map((row) => row.id)).toEqual([String(acme.firmId)]);
    expect(csv.user?.map((row) => Number(row.id)).toSorted(byNumber)).toEqual(
      acme.userIds.toSorted(byNumber),
    );
    expect(Object.keys(csv.user![0]!)).toEqual(["id", "name", "email"]);
  });

  test("matches each file's row count and SHA-256 to the manifest", async ({
    migratorOrm,
    parent,
  }) => {
    await seedExportFirm(migratorOrm, "acme");
    await seedExportFirm(migratorOrm, "globex");
    const out = join(parent, "out");

    await exportRecords(migratorOrm, { slug: "acme", out, reason: "Firm's own request" });

    const manifest: Manifest = JSON.parse(await readFile(join(out, "manifest.json"), "utf8"));
    const contents = await Promise.all(manifest.files.map(({ file }) => readFile(join(out, file))));
    for (const [index, entry] of manifest.files.entries()) {
      const bytes = contents[index]!;
      expect(sha256(bytes), entry.file).toBe(entry.sha256);
      const rows: string[][] = parse(bytes);
      expect(rows[0], entry.file).toEqual(entry.columns.map(({ name }) => name));
      expect(rows.length - 1, entry.file).toBe(entry.rows);
    }
    const counts = Object.fromEntries(manifest.files.map(({ table, rows }) => [table, rows]));
    expect(counts).toMatchObject({ organization: 1, member: 1, invitation: 2, user: 3 });
    expect(counts.household).toBe(2);
  });

  test("keeps a jsonb value and text with a comma, a quote and a newline through CSV", async ({
    migratorOrm,
    parent,
  }) => {
    await seedExportFirm(migratorOrm, "acme");
    const out = join(parent, "out");

    await exportRecords(migratorOrm, { slug: "acme", out, reason: "Firm's own request" });

    const households = await readCsv(out, "household.csv");
    expect(households.map((row) => row.name)).toContain(TRICKY);
    const events = await readCsv(out, "audit_event.csv");
    const roleChange = events.find((row) => row.action === "org.member.role_changed");
    expect(JSON.parse(roleChange!.metadata!)).toEqual(METADATA);
  });

  test("audits org.records_exported with no actor, the counts and the manifest's hash", async ({
    migratorOrm,
    parent,
  }) => {
    const acme = await seedExportFirm(migratorOrm, "acme");
    const out = join(parent, "out");

    await exportRecords(migratorOrm, { slug: "acme", out, reason: "Firm's own request" });

    const manifestBytes = await readFile(join(out, "manifest.json"));
    const manifest: Manifest = JSON.parse(manifestBytes.toString("utf8"));
    expect(await exportEvents(migratorOrm)).toEqual([
      {
        actorUserId: null,
        organizationId: acme.firmId,
        targetType: "organization",
        targetId: acme.publicId,
        metadata: {
          via: "cli",
          reason: "Firm's own request",
          firmState: "active",
          tables: Object.fromEntries(manifest.files.map(({ table, rows }) => [table, rows])),
          manifestHash: sha256(manifestBytes),
        },
      },
    ]);
  });

  test("exports a deactivated Firm and says so", async ({ migratorOrm, parent }) => {
    await seedExportFirm(migratorOrm, "acme");
    await deactivateOrganization(migratorOrm, { slug: "acme", reason: "Closed" });
    const out = join(parent, "out");

    const result = await exportRecords(migratorOrm, {
      slug: "acme",
      out,
      reason: "Firm's own request",
    });

    expect(result.firmState).toBe("deactivated");
    const manifest: Manifest = JSON.parse(await readFile(join(out, "manifest.json"), "utf8"));
    expect(manifest.firm.state).toBe("deactivated");
    const [event] = await exportEvents(migratorOrm);
    expect(event?.metadata).toMatchObject({ firmState: "deactivated" });
  });

  test("reads a table larger than one batch whole, each row once and in order", async ({
    migratorOrm,
    parent,
  }) => {
    const acme = await seedExportFirm(migratorOrm, "acme");
    // Past two batches of 1,000, so the reads after the first and the last partial one both run.
    await migratorOrm.insert(household).values(
      Array.from({ length: 2500 }, (_, index) => ({
        firmId: acme.firmId,
        name: `Household ${index}`,
        relationshipStatus: "prospect" as const,
      })),
    );
    const out = join(parent, "out");

    await exportRecords(migratorOrm, { slug: "acme", out, reason: "Firm's own request" });

    const ids = (await readCsv(out, "household.csv")).map((row) => Number(row.id));
    expect(ids).toHaveLength(2502);
    expect(new Set(ids).size).toBe(2502);
    expect(ids).toEqual(ids.toSorted(byNumber));
  });

  test("makes the folder 0700 and every file 0600", async ({ migratorOrm, parent }) => {
    await seedExportFirm(migratorOrm, "acme");
    const out = join(parent, "out");

    await exportRecords(migratorOrm, { slug: "acme", out, reason: "Firm's own request" });

    expect((await stat(out)).mode & 0o777).toBe(0o700);
    const files = await readdir(out);
    const modes = await Promise.all(files.map(async (file) => (await stat(join(out, file))).mode));
    expect(new Set(modes.map((mode) => mode & 0o777))).toEqual(new Set([0o600]));
  });

  test("writes into an --out that exists and is empty", async ({ migratorOrm, parent }) => {
    await seedExportFirm(migratorOrm, "acme");
    const out = join(parent, "out");
    await mkdir(out);

    await exportRecords(migratorOrm, { slug: "acme", out, reason: "Firm's own request" });

    expect(await readdir(out)).toContain("manifest.json");
  });

  test("refuses an --out that isn't empty and writes nothing", async ({ migratorOrm, parent }) => {
    await seedExportFirm(migratorOrm, "acme");
    const out = join(parent, "out");
    await mkdir(out);
    await writeFile(join(out, "keep.txt"), "mine");

    await expect(
      exportRecords(migratorOrm, { slug: "acme", out, reason: "Firm's own request" }),
    ).rejects.toMatchObject({ code: "out_not_empty" });
    expect(await readdir(out)).toEqual(["keep.txt"]);
    expect(await readdir(parent)).toEqual(["out"]);
    expect(await exportEvents(migratorOrm)).toEqual([]);
  });

  test("refuses an unknown slug and leaves nothing", async ({ migratorOrm, parent }) => {
    await seedExportFirm(migratorOrm, "acme");

    await expect(
      exportRecords(migratorOrm, {
        slug: "nope",
        out: join(parent, "out"),
        reason: "Firm's own request",
      }),
    ).rejects.toMatchObject({ code: "unknown_organization" });
    expect(await readdir(parent)).toEqual([]);
  });

  test("refuses to run as a role other than migrator", async ({ orm, migratorOrm, parent }) => {
    await seedExportFirm(migratorOrm, "acme");

    await expect(
      exportRecords(orm, {
        slug: "acme",
        out: join(parent, "out"),
        reason: "Firm's own request",
      }),
    ).rejects.toMatchObject({ code: "wrong_role", message: expect.stringMatching(/migrator/) });
    expect(await readdir(parent)).toEqual([]);
  });

  test("with dryRun, counts each table's rows and writes nothing", async ({
    migratorOrm,
    parent,
  }) => {
    const acme = await seedExportFirm(migratorOrm, "acme");
    await seedExportFirm(migratorOrm, "globex");
    const out = join(parent, "out");

    const result = await exportRecords(migratorOrm, {
      slug: "acme",
      out,
      reason: "Firm's own request",
      dryRun: true,
    });

    expect(result).toMatchObject({
      out,
      firm: { slug: "acme", publicId: acme.publicId },
      firmState: "active",
      manifestHash: null,
      dryRun: true,
    });
    expect(await readdir(parent)).toEqual([]);
    expect(await exportEvents(migratorOrm)).toEqual([]);
    const written = await exportRecords(migratorOrm, { slug: "acme", out, reason: "Firm's own" });
    expect(result.tables).toEqual(written.tables);
  });

  test("with dryRun, still refuses an --out that isn't empty", async ({ migratorOrm, parent }) => {
    await seedExportFirm(migratorOrm, "acme");
    await writeFile(join(parent, "keep.txt"), "mine");

    await expect(
      exportRecords(migratorOrm, {
        slug: "acme",
        out: parent,
        reason: "Firm's own request",
        dryRun: true,
      }),
    ).rejects.toMatchObject({ code: "out_not_empty" });
  });

  test("leaves nothing, at --out or beside it, when the audit write fails", async ({
    migratorOrm,
    parent,
  }) => {
    await seedExportFirm(migratorOrm, "acme");
    await migratorOrm.execute(sql`
      create function refuse_export() returns trigger language plpgsql as $$
      begin raise exception 'audit write refused'; end $$;
      create trigger refuse_export before insert on audit_event
        for each row when (new.action = 'org.records_exported') execute function refuse_export();
    `);

    await expect(
      exportRecords(migratorOrm, {
        slug: "acme",
        out: join(parent, "out"),
        reason: "Firm's own request",
      }),
    ).rejects.toMatchObject({
      code: "audit_failed",
      message: expect.stringMatching(
        /Couldn't record the export in the audit trail, so nothing was written: audit write refused/,
      ),
    });
    expect(await readdir(parent)).toEqual([]);
  });

  test("reads in one repeatable read, read only transaction", async ({ migratorOrm, parent }) => {
    await seedExportFirm(migratorOrm, "acme");
    // A spy still calls through, so this only records the options the transaction opens with.
    const transaction = vi.spyOn(migratorOrm, "transaction");

    await exportRecords(migratorOrm, {
      slug: "acme",
      out: join(parent, "out"),
      reason: "Firm's own",
    });

    expect(transaction.mock.calls.map(([, config]) => config)).toEqual([
      { isolationLevel: "repeatable read", accessMode: "read only" },
    ]);
  });
});
