import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliError } from "@repo/db/cli/cli-error";
import { worktreeResources } from "./names.ts";
import { type SetupSystem, setUpWorktree } from "./setup.ts";

const ID = "feat-x";
const { database } = worktreeResources(ID);

/** A main checkout with a worktree in it, removed after the test. */
function checkout() {
  const main = mkdtempSync(join(tmpdir(), "cw-setup-"));
  onTestFinished(() => rmSync(main, { recursive: true, force: true }));
  const top = join(main, ".claude/worktrees/feat-x");
  mkdirSync(join(top, "apps/web"), { recursive: true });
  return { mainCheckout: main, top, worktreeId: ID };
}

type FakeSystemArgs = { created?: boolean; populate?: SetupSystem["populate"] };

function fakeSystem({ created = true, populate }: FakeSystemArgs = {}) {
  const system: SetupSystem = {
    assertSecrets: vi.fn(),
    startServices: vi.fn(),
    createDatabase: vi.fn(async () => created),
    dropDatabase: vi.fn(async () => true),
    run: vi.fn(() => ({ status: 0, stdout: "", stderr: "" })),
    populate: vi.fn(
      populate ??
        (async () => ({
          ingested: [
            { asOf: "2026-03-02", status: "ingested" as const },
            { asOf: "2026-03-06", status: "ingested" as const },
          ],
          notes: [],
        })),
    ),
  };
  return system;
}

describe("setUpWorktree", () => {
  it("migrates, seeds and ingests the example Deliveries into a new database", async () => {
    const worktree = checkout();
    const system = fakeSystem();

    const { created, ingested } = await setUpWorktree({ ...worktree, system });

    expect(created).toBe(true);
    expect(ingested).toEqual([
      { asOf: "2026-03-02", status: "ingested" },
      { asOf: "2026-03-06", status: "ingested" },
    ]);
    expect(system.populate).toHaveBeenCalledWith({
      checkout: worktree.top,
      url: expect.any(Function),
      secrets: join(worktree.mainCheckout, ".secrets"),
      domain: undefined,
      run: system.run,
    });
    const { url } = vi.mocked(system.populate).mock.calls[0]![0];
    expect(url("app")).toBe(`postgres://app@localhost:5433/${database}`);
    expect(readFileSync(join(worktree.top, "apps/web/.env.local"), "utf8")).toContain(database);
  });

  it("only migrates a database that exists, and ingests nothing", async () => {
    const worktree = checkout();
    const system = fakeSystem({ created: false });

    const { created, ingested } = await setUpWorktree({ ...worktree, system });

    expect(created).toBe(false);
    expect(ingested).toEqual([]);
    expect(system.populate).not.toHaveBeenCalled();
    expect(system.run).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["--silent", "--filter", "@repo/db", "db:migrate"],
        cwd: worktree.top,
      }),
    );
  });

  it("drops a new database whose ingest is refused, and passes the refusal on", async () => {
    const worktree = checkout();
    const system = fakeSystem({
      populate: async () => {
        throw new CliError({ code: "incomplete", message: "Refused the example Delivery." });
      },
    });

    await expect(setUpWorktree({ ...worktree, system })).rejects.toMatchObject({
      code: "incomplete",
    });
    expect(system.dropDatabase).toHaveBeenCalledWith({
      mainCheckout: worktree.mainCheckout,
      database,
    });
  });

  it("refuses a failed migration of an existing database as migrate_failed, and keeps it", async () => {
    const worktree = checkout();
    const system = fakeSystem({ created: false });
    vi.mocked(system.run).mockReturnValue({ status: 1, stdout: "", stderr: "relation exists" });

    await expect(setUpWorktree({ ...worktree, system })).rejects.toMatchObject({
      code: "migrate_failed",
    });
    expect(system.dropDatabase).not.toHaveBeenCalled();
  });
});
