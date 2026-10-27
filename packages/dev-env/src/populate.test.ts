import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DomainCalls, type RunArgs, type RunResult, populate } from "./populate.ts";

type CheckoutArgs = { cw?: boolean; ingest?: boolean; deliveries?: string[] };

/** A checkout with only the files `populate` looks for, removed after the test. */
function checkout({
  cw = true,
  ingest = true,
  deliveries = ["2026-03-02", "2026-03-06"],
}: CheckoutArgs = {}) {
  const dir = mkdtempSync(join(tmpdir(), "cw-populate-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const commands = join(dir, "packages/cli/src/commands");
  if (cw) {
    mkdirSync(commands, { recursive: true });
    writeFileSync(join(commands, "db.ts"), "");
    if (ingest) writeFileSync(join(commands, "custodian.ts"), "");
  }
  for (const asOf of deliveries) {
    mkdirSync(join(dir, "apps/custodian/fixtures/feed", asOf), { recursive: true });
  }
  return dir;
}

const ok = (stdout: unknown = {}): RunResult => ({
  status: 0,
  stdout: JSON.stringify(stdout),
  stderr: "",
});

/** A runner that answers each command as `answer` says, and records what ran. */
function runner(
  answer: (args: RunArgs) => RunResult = (args) => {
    if (args.args.includes("seed")) return ok({ added: { users: 3, households: 4 } });
    if (args.args.includes("ingest")) return ok({ asOf: args.args[3], status: "ingested" });
    return ok();
  },
) {
  const ran: RunArgs[] = [];
  return {
    ran,
    run: (args: RunArgs) => {
      ran.push(args);
      return answer(args);
    },
  };
}

const url = (role: string) => `postgres://${role}@localhost:5433/verify_main_head`;

describe("populate", () => {
  it("migrates as migrator, then seeds and ingests each example Delivery as app, through cw", async () => {
    const dir = checkout();
    const { ran, run } = runner();

    const populated = await populate({ checkout: dir, url, secrets: "/repo/.secrets", run });

    expect(populated).toEqual({
      seeded: { users: 3, households: 4 },
      ingested: [
        { asOf: "2026-03-02", status: "ingested" },
        { asOf: "2026-03-06", status: "ingested" },
      ],
      notes: [],
    });
    const feed = join(dir, "apps/custodian/fixtures/feed");
    expect(ran.map(({ args }) => args)).toEqual([
      ["--silent", "--filter", "@repo/db", "db:migrate"],
      ["--silent", "cw", "db", "seed", "--json"],
      ["--silent", "cw", "custodian", "ingest", "2026-03-02", "--root", feed, "--json"],
      ["--silent", "cw", "custodian", "ingest", "2026-03-06", "--root", feed, "--json"],
    ]);
    expect(ran.every(({ cwd }) => cwd === dir)).toBe(true);
    expect(ran[0]?.env).toEqual({
      DATABASE_URL: url("migrator"),
      DATABASE_PASSWORD_FILE: "/repo/.secrets/db_migrator_password",
    });
    expect(ran[1]?.env).toEqual({
      DATABASE_URL: url("app"),
      DATABASE_PASSWORD_FILE: "/repo/.secrets/db_app_password",
    });
  });

  it("seeds and ingests through the calls it's handed, as app, and runs only the migration", async () => {
    const dir = checkout({ cw: false });
    const { ran, run } = runner();
    const domain = {
      seed: vi.fn<DomainCalls["seed"]>(async () => ({ users: 3, households: 4 })),
      ingest: vi.fn<DomainCalls["ingest"]>(async () => "already_ingested"),
    };

    const populated = await populate({ checkout: dir, url, secrets: "/s", run, domain });

    expect(ran.map(({ args }) => args)).toEqual([
      ["--silent", "--filter", "@repo/db", "db:migrate"],
    ]);
    const target = { url: url("app"), passwordFile: "/s/db_app_password" };
    expect(domain.seed).toHaveBeenCalledWith(target);
    expect(domain.ingest.mock.calls.map(([args]) => args)).toEqual([
      { target, asOf: "2026-03-02", root: join(dir, "apps/custodian/fixtures/feed") },
      { target, asOf: "2026-03-06", root: join(dir, "apps/custodian/fixtures/feed") },
    ]);
    expect(populated).toEqual({
      seeded: { users: 3, households: 4 },
      ingested: [
        { asOf: "2026-03-02", status: "already_ingested" },
        { asOf: "2026-03-06", status: "already_ingested" },
      ],
      notes: [],
    });
  });

  it("fails with cw's own code when the seed refuses", async () => {
    const { run } = runner((args) =>
      args.args.includes("seed")
        ? {
            status: 1,
            stdout: JSON.stringify({ code: "seed_conflict", message: "Household x differs" }),
            stderr: "",
          }
        : ok(),
    );

    await expect(populate({ checkout: checkout(), url, secrets: "/s", run })).rejects.toMatchObject(
      {
        code: "seed_conflict",
        message: "cw db seed: Household x differs",
      },
    );
  });

  it("fails as migrate_failed with the migration's output", async () => {
    const { run } = runner(() => ({ status: 1, stdout: "", stderr: "relation exists" }));

    await expect(populate({ checkout: checkout(), url, secrets: "/s", run })).rejects.toMatchObject(
      {
        code: "migrate_failed",
        message: expect.stringContaining("relation exists"),
      },
    );
  });

  it("seeds a ref from before cw with its own db:seed, and ingests nothing", async () => {
    const dir = checkout({ cw: false, deliveries: [] });
    const { ran, run } = runner();

    const populated = await populate({ checkout: dir, url, secrets: "/s", run });

    expect(ran.map(({ args }) => args).slice(1)).toEqual([["--silent", "db:seed"]]);
    expect(populated).toEqual({
      seeded: undefined,
      ingested: [],
      notes: [
        "seeded with this checkout's pnpm db:seed, which predates cw",
        "no Delivery ingested: this checkout has no cw custodian ingest",
      ],
    });
  });

  it("ingests nothing in a checkout whose cw has no custodian ingest", async () => {
    const { ran, run } = runner();

    const populated = await populate({
      checkout: checkout({ ingest: false }),
      url,
      secrets: "/s",
      run,
    });

    expect(ran).toHaveLength(2);
    expect(populated.ingested).toEqual([]);
    expect(populated.notes).toEqual([
      "no Delivery ingested: this checkout has no cw custodian ingest",
    ]);
  });
});
