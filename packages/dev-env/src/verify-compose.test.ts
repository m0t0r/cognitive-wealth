import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyResources } from "./names.ts";
import { type ComposeSystem, composeUp, ensureSecrets } from "./verify-compose.ts";

const ID = "feat-x";
const { compose } = verifyResources(ID);

const COMPOSE_YAML = `services: {}
secrets:
  postgres_password:
    file: ./.secrets/postgres_password
  db_app_password:
    file: ./.secrets/db_app_password
`;

/** A checkout with only a compose.yaml, removed after the test. */
function checkout() {
  const main = mkdtempSync(join(tmpdir(), "cw-verify-compose-"));
  onTestFinished(() => rmSync(main, { recursive: true, force: true }));
  const top = join(main, ".claude/worktrees/feat-x");
  mkdirSync(top, { recursive: true });
  writeFileSync(join(top, "compose.yaml"), COMPOSE_YAML);
  return { mainCheckout: main, top, worktreeId: ID };
}

function fakeSystem({ running = ["db", "web"] }: { running?: string[] } = {}) {
  const calls: string[][] = [];
  const system: ComposeSystem = {
    docker: vi.fn(({ args }) => {
      calls.push(args.slice(args.indexOf("-f", args.indexOf("-f") + 1) + 2));
      return {
        status: 0,
        stdout: args.includes("ps") ? `${running.join("\n")}\n` : "",
        stderr: "",
      };
    }),
    populate: vi.fn(async () => ({
      seeded: { users: 3, households: 2 },
      ingested: [{ asOf: "2026-03-02", status: "already_ingested" as const }],
      notes: [],
    })),
  };
  return { system, calls };
}

describe("ensureSecrets", () => {
  it("writes every secret compose.yaml names that's missing, and keeps the rest", () => {
    const { top } = checkout();
    mkdirSync(join(top, ".secrets"));
    writeFileSync(join(top, ".secrets/postgres_password"), "kept\n");

    expect(ensureSecrets(top)).toEqual(["db_app_password"]);

    expect(readFileSync(join(top, ".secrets/postgres_password"), "utf8")).toBe("kept\n");
    expect(readFileSync(join(top, ".secrets/db_app_password"), "utf8")).toMatch(/^[0-9a-f]{64}\n$/);
    expect(statSync(join(top, ".secrets/db_app_password")).mode & 0o777).toBe(0o644);
  });
});

describe("composeUp", () => {
  it("starts the checkout's own project on its own ports, then migrates, seeds and ingests its db", async () => {
    const co = checkout();
    const { system, calls } = fakeSystem();

    const up = await composeUp({ checkout: co, services: [], system });

    expect(up).toEqual({
      project: compose.project,
      urls: {
        web: `http://localhost:${compose.ports.web}`,
        custodian: `http://127.0.0.1:${compose.ports.custodian}`,
        mailpit: `http://127.0.0.1:${compose.ports.mailpit}`,
      },
      database: `postgres://app@localhost:${compose.ports.db}/cognitive_wealth`,
      passwordFile: join(co.top, ".secrets/db_app_password"),
      ingested: [{ asOf: "2026-03-02", status: "already_ingested" }],
      notes: [],
    });
    expect(calls).toEqual([
      ["up", "--build", "--detach", "--wait"],
      ["ps", "--status", "running", "--services"],
    ]);
    const [{ args, env }] = vi.mocked(system.docker).mock.calls[0]!;
    expect(args.slice(0, 7)).toEqual([
      "compose",
      "-p",
      compose.project,
      "--project-directory",
      co.top,
      "-f",
      join(co.top, "compose.yaml"),
    ]);
    expect(env).toEqual({
      WEB_PORT: String(compose.ports.web),
      CUSTODIAN_PORT: String(compose.ports.custodian),
      MAILPIT_PORT: String(compose.ports.mailpit),
      DB_PORT: String(compose.ports.db),
    });
    expect(system.populate).toHaveBeenCalledWith(
      expect.objectContaining({ checkout: co.top, secrets: join(co.top, ".secrets") }),
    );
  });

  it("runs a named one-shot on its own, since up --wait fails on one that exited", async () => {
    const { system, calls } = fakeSystem();

    await composeUp({ checkout: checkout(), services: ["migrate", "web"], system });

    expect(calls.slice(0, 2)).toEqual([
      ["up", "--build", "--detach", "--wait", "web"],
      ["run", "--rm", "--build", "migrate"],
    ]);
  });

  it("runs only the one-shot when it's all that's named", async () => {
    const { system, calls } = fakeSystem();

    await composeUp({ checkout: checkout(), services: ["custodian-migrate"], system });

    expect(calls[0]).toEqual(["run", "--rm", "--build", "custodian-migrate"]);
  });

  it("leaves the data alone when db isn't running", async () => {
    const { system } = fakeSystem({ running: ["custodian"] });

    const up = await composeUp({ checkout: checkout(), services: ["custodian"], system });

    expect(system.populate).not.toHaveBeenCalled();
    expect(up.database).toBeUndefined();
  });

  it("fails as compose_failed with Compose's output", async () => {
    const { system } = fakeSystem();
    system.docker = () => ({ status: 1, stdout: "", stderr: "container web-1 is unhealthy" });

    await expect(composeUp({ checkout: checkout(), services: [], system })).rejects.toMatchObject({
      code: "compose_failed",
      message: expect.stringContaining("container web-1 is unhealthy"),
    });
  });
});
