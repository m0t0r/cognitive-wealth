import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyResources } from "./names.ts";
import { type ServerSystem, planVerifyServer, startVerifyServer } from "./verify-server.ts";
import { serverFilesOf } from "./verify.ts";

const ID = "feat-x";
const { token: TOKEN, ports, databases } = verifyResources(ID);

/** `cw`'s own seed and Ingestion, which only the working tree's database gets. */
const DOMAIN = {
  seed: async () => {},
  ingest: async () => "ingested" as const,
};

/** A main checkout of its own, only its `.dev/`, removed after the test. */
function mainCheckout() {
  const dir = mkdtempSync(join(tmpdir(), "cw-verify-server-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

type FakeArgs = {
  /** What listens on each port, in the order `listenerOn` is asked. */
  listeners?: Array<number | undefined>;
  commands?: Record<number, string>;
  healthy?: boolean;
};

/** Every outside effect, recorded in `calls` in the order they happen. */
function fakeSystem({ listeners = [], commands = {}, healthy = true }: FakeArgs = {}) {
  const calls: string[] = [];
  const asked = [...listeners];
  const system: ServerSystem = {
    listenerOn: () => asked.shift(),
    commandOf: (pid) => commands[pid],
    stop: vi.fn(async (pid: number) => {
      calls.push(`stop ${pid}`);
      return true;
    }),
    exec: vi.fn(({ command, args }) => {
      calls.push(`${command} ${args.join(" ")}`);
      return { status: 0, stdout: command === "git" ? "1a2b3c4\n" : "", stderr: "" };
    }),
    startServices: vi.fn(() => {
      calls.push("services");
    }),
    recreateDatabase: vi.fn(async ({ database }) => {
      calls.push(`recreate ${database}`);
    }),
    populate: vi.fn(async ({ checkout }) => {
      calls.push(`populate ${checkout}`);
      return {
        ingested: [{ asOf: "2026-03-02", status: "ingested" as const }],
        notes: [],
      };
    }),
    householdsIn: vi.fn(async () => [{ name: "Grace", publicId: "0b5e" }]),
    layOutStandalone: vi.fn(() => {
      calls.push("lay out");
    }),
    spawnServer: vi.fn(() => {
      calls.push("spawn");
      return 4242;
    }),
    waitHealthy: vi.fn(async () => healthy),
    now: () => 1_800_000_000_000,
  };
  return { system, calls };
}

const checkoutOf = (main: string) => ({
  mainCheckout: main,
  top: join(main, ".claude/worktrees/feat-x"),
  worktreeId: ID,
});

describe("startVerifyServer", () => {
  it("serves the working tree on its own port and database, and records the server", async () => {
    const main = mainCheckout();
    const { system, calls } = fakeSystem();
    const checkout = checkoutOf(main);

    const started = await startVerifyServer({ checkout, domain: DOMAIN, system });

    expect(system.populate).toHaveBeenCalledWith({
      checkout: checkout.top,
      url: expect.any(Function),
      secrets: join(main, ".secrets"),
      domain: DOMAIN,
    });

    const url = `http://localhost:${ports.head}`;
    expect(started).toEqual({
      url,
      role: "head",
      pid: 4242,
      database: `postgres://app@localhost:5433/${databases.head}`,
      passwordFile: join(main, ".secrets/db_app_password"),
      households: [{ name: "Grace", publicId: "0b5e" }],
      ingested: [{ asOf: "2026-03-02", status: "ingested" }],
      notes: [],
      checkout: checkout.top,
      log: serverFilesOf({ mainCheckout: main, token: TOKEN, role: "head" }).log,
    });
    expect(calls).toEqual([
      "services",
      `recreate ${databases.head}`,
      `populate ${checkout.top}`,
      "pnpm exec turbo build --filter=web --output-logs=errors-only",
      "lay out",
      "spawn",
    ]);
    const { pid } = serverFilesOf({ mainCheckout: main, token: TOKEN, role: "head" });
    expect(readFileSync(pid, "utf8").trim()).toBe("4242");
    expect(system.spawnServer).toHaveBeenCalledWith({
      script: join(checkout.top, "apps/web/.next/standalone/apps/web/server.js"),
      log: started.log,
      env: expect.objectContaining({
        NODE_ENV: "production",
        PORT: String(ports.head),
        BETTER_AUTH_URL: url,
        DATABASE_URL: started.database,
        REDIS_KEY_PREFIX: `cw:v:${TOKEN}:head:1800000000:`,
      }),
    });
  });

  it("refuses a port another process holds before changing anything", async () => {
    const main = mainCheckout();
    const { system, calls } = fakeSystem({ listeners: [999], commands: { 999: "node other.js" } });

    await expect(startVerifyServer({ checkout: checkoutOf(main), system })).rejects.toMatchObject({
      code: "port_taken",
      message: expect.stringContaining(`pid 999: node other.js`),
    });
    expect(calls).toEqual([]);
  });

  it("replaces the server it recorded for the role, after the build", async () => {
    const main = mainCheckout();
    const { pid } = serverFilesOf({ mainCheckout: main, token: TOKEN, role: "head" });
    mkdirSync(join(pid, ".."), { recursive: true });
    writeFileSync(pid, "77\n");
    const { system, calls } = fakeSystem({
      listeners: [77, undefined],
      commands: { 77: "next-server (v16.4.2)" },
    });

    await startVerifyServer({ checkout: checkoutOf(main), system });

    expect(calls.slice(-3)).toEqual(["lay out", "stop 77", "spawn"]);
  });

  it("leaves a recorded pid alone once it's another process", async () => {
    const main = mainCheckout();
    const { pid } = serverFilesOf({ mainCheckout: main, token: TOKEN, role: "head" });
    mkdirSync(join(pid, ".."), { recursive: true });
    writeFileSync(pid, "77\n");
    const { system } = fakeSystem({ listeners: [77], commands: { 77: "vim notes.md" } });

    await expect(startVerifyServer({ checkout: checkoutOf(main), system })).rejects.toMatchObject({
      code: "port_taken",
    });
    expect(system.stop).not.toHaveBeenCalled();
  });

  it("refuses a port taken during the build, without starting a server", async () => {
    const main = mainCheckout();
    const { system } = fakeSystem({
      listeners: [undefined, 555],
      commands: { 555: "python3 -m http.server" },
    });

    await expect(startVerifyServer({ checkout: checkoutOf(main), system })).rejects.toMatchObject({
      code: "port_taken",
      message: expect.stringContaining("during the build"),
    });
    expect(system.spawnServer).not.toHaveBeenCalled();
  });

  it("fails as unhealthy, naming the server's log", async () => {
    const main = mainCheckout();
    const { system } = fakeSystem({ healthy: false });
    const { log } = serverFilesOf({ mainCheckout: main, token: TOKEN, role: "head" });

    await expect(startVerifyServer({ checkout: checkoutOf(main), system })).rejects.toMatchObject({
      code: "unhealthy",
      message: expect.stringContaining(log),
    });
  });

  it("fails as build_failed with the build's output", async () => {
    const main = mainCheckout();
    const { system } = fakeSystem();
    system.exec = () => ({ status: 1, stdout: "Type error: x is not y", stderr: "" });

    await expect(startVerifyServer({ checkout: checkoutOf(main), system })).rejects.toMatchObject({
      code: "build_failed",
      message: expect.stringContaining("Type error: x is not y"),
    });
    expect(system.spawnServer).not.toHaveBeenCalled();
  });

  it("builds a --ref in a checkout of its own, on the ref port and database", async () => {
    const main = mainCheckout();
    const { system, calls } = fakeSystem();
    const refCheckout = join(main, `.dev/worktrees/${TOKEN}-1a2b3c4`);

    const started = await startVerifyServer({
      checkout: checkoutOf(main),
      ref: "dev",
      domain: DOMAIN,
      system,
    });

    // The ref's own cw seeds its own schema, not this checkout's code.
    expect(system.populate).toHaveBeenCalledWith(expect.objectContaining({ domain: undefined }));
    expect(started).toMatchObject({
      url: `http://localhost:${ports.ref}`,
      role: "ref",
      database: `postgres://app@localhost:5433/${databases.ref}`,
      checkout: refCheckout,
    });
    expect(calls.slice(0, 4)).toEqual([
      "git rev-parse --short dev^{commit}",
      `git -C ${main} worktree add --detach ${refCheckout} 1a2b3c4`,
      "pnpm install --frozen-lockfile --prefer-offline --silent",
      "services",
    ]);
    expect(calls).toContain(`populate ${refCheckout}`);
  });

  it("runs --seed from the working tree after the world, on a port of its choosing", async () => {
    const main = mainCheckout();
    const { system, calls } = fakeSystem();
    const checkout = checkoutOf(main);
    system.exec = vi.fn(({ command, args }) => {
      calls.push(`${command} ${args.join(" ")}`);
      return { status: 0, stdout: command === "node" ? 'Ran seedGrace: "0b5e"\n' : "", stderr: "" };
    });

    const started = await startVerifyServer({
      checkout,
      port: 3999,
      seed: "/abs/households.ts:seedGrace",
      system,
    });

    expect(started.url).toBe("http://localhost:3999");
    expect(started.seed).toBe('Ran seedGrace: "0b5e"');
    expect(calls).toContain(
      `node ${join(checkout.top, "packages/db/src/cli/run-seed.ts")} /abs/households.ts:seedGrace`,
    );
  });

  it("planVerifyServer says what it would serve and changes nothing", async () => {
    const main = mainCheckout();
    const { system, calls } = fakeSystem();

    const plan = planVerifyServer({ checkout: checkoutOf(main), system });

    expect(plan).toMatchObject({ url: `http://localhost:${ports.head}`, role: "head" });
    expect(calls).toEqual([]);
    expect(existsSync(join(main, ".dev"))).toBe(false);
  });
});
