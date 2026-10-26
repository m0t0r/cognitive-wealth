import type { DevEnv } from "../dependencies";
import { createCli } from "../app";
import { dependencies, run } from "../testing";

const ORPHAN = {
  token: "gone_0badc0de",
  database: "wt_gone_0badc0de",
  redisPrefix: "cw:wt:gone_0badc0de:",
};

/** A dev environment with one orphan, whose `prune` gives back `pruned`. */
function devEnv(pruned: Awaited<ReturnType<DevEnv["prune"]>>) {
  const env = {
    mainCheckout: "/repo",
    findOrphans: vi.fn(async () => ({
      environments: [{ ...ORPHAN, server: { pid: 41 } }],
      servers: [{ pid: 42, cwd: "/old/apps/web" }],
    })),
    prune: vi.fn(async () => pruned),
  };
  return { env, cli: createCli(dependencies({ devEnv: async () => env })) };
}

describe("cw dev prune", () => {
  it("lists the orphans with --dry-run, and tears nothing down", async () => {
    const { env, cli } = devEnv({ removed: [], failed: [] });
    const { output, exitCode } = await run({ cli, argv: ["dev", "prune", "--dry-run"] });
    expect(exitCode).toBe(0);
    expect(output).toEqual({
      dryRun: true,
      removed: [],
      orphans: [{ database: ORPHAN.database, redisPrefix: ORPHAN.redisPrefix, pid: 41 }],
      servers: [{ pid: 42, cwd: "/old/apps/web" }],
    });
    expect(env.prune).not.toHaveBeenCalled();
  });

  it("says what it tore down", async () => {
    const { env, cli } = devEnv({ removed: ["wt_gone_0badc0de: dropped"], failed: [] });
    const { output, exitCode } = await run({ cli, argv: ["dev", "prune"] });
    expect(exitCode).toBe(0);
    expect(output).toMatchObject({ dryRun: false, removed: ["wt_gone_0badc0de: dropped"] });
    expect(env.prune).toHaveBeenCalledWith("/repo");
  });

  it("fails with prune_failed, retryable, naming every failure", async () => {
    const { cli } = devEnv({ removed: ["a: dropped"], failed: ["b: Redis said no"] });
    const { output, exitCode } = await run({ cli, argv: ["dev", "prune"] });
    expect(exitCode).toBe(1);
    expect(output).toMatchObject({
      code: "prune_failed",
      retryable: true,
      message: "Tore down 1, and failed on:\nb: Redis said no",
    });
  });
});
