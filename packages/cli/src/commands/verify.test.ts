import { verifyResources } from "@repo/dev-env/names";
import type { Verify } from "../dependencies";
import { createCli } from "../app";
import { dependencies, run } from "../testing";

const WORKTREE = "/repo/.claude/worktrees/feat-x";
const { token: TOKEN, session: SESSION } = verifyResources("feat-x");
const REF_CHECKOUT = `/repo/.dev/worktrees/${TOKEN}-1a2b3c4`;

type FakeVerifyArgs = {
  /** Run `cw` in the main checkout rather than a worktree. */
  inMainCheckout?: boolean;
  /** The token `chrome.owner` names. */
  holder?: string;
  stopVerifyServers?: Verify["stopVerifyServers"];
  startVerifyServer?: Verify["startVerifyServer"];
  startBrowser?: Verify["startBrowser"];
  /** Whether `dev sign-in` left a session file. */
  signedIn?: boolean;
};

const STARTED = {
  url: "http://localhost:3500",
  role: "head" as const,
  pid: 4242,
  database: `postgres://app@localhost:5433/verify_${TOKEN}_head`,
  passwordFile: "/repo/.secrets/db_app_password",
  households: [{ name: "Grace", publicId: "0b5e" }],
  ingested: [{ asOf: "2026-03-02", status: "ingested" as const }],
  notes: [],
  checkout: WORKTREE,
  log: `/repo/.dev/verify/${TOKEN}/server-head.log`,
};

/** This checkout's verifier state: one server and one --ref checkout. */
function fakeVerify({
  inMainCheckout = false,
  holder,
  stopVerifyServers = async () => "stopped the verification server pid 41",
  startVerifyServer = async () => STARTED,
  startBrowser = async () => ({
    session: SESSION,
    statePath: `${WORKTREE}/.dev/auth/owner@cognitive-wealth.test.json`,
    chrome: { pid: 9100, started: true },
  }),
  signedIn = true,
}: FakeVerifyArgs = {}) {
  const env = {
    mainCheckout: "/repo",
    top: inMainCheckout ? "/repo" : WORKTREE,
    worktreeId: inMainCheckout ? undefined : "feat-x",
    verifyServersOf: vi.fn(() => [41]),
    stopVerifyServers: vi.fn(stopVerifyServers),
    refCheckoutsOf: vi.fn(() => [REF_CHECKOUT]),
    removeRefCheckouts: vi.fn(() => `removed the --ref checkouts ${TOKEN}-1a2b3c4`),
    chromeHolder: vi.fn(() => holder),
    releaseChrome: vi.fn(async () => "stopped the shared Chrome (pid 42)"),
    planVerifyServer: vi.fn(() => ({
      url: STARTED.url,
      role: "head" as const,
      database: STARTED.database,
      passwordFile: STARTED.passwordFile,
      checkout: WORKTREE,
      log: STARTED.log,
      replaces: 41,
    })),
    startVerifyServer: vi.fn(startVerifyServer),
    sessionFileOf: vi.fn(() =>
      signedIn ? `${WORKTREE}/.dev/auth/owner@cognitive-wealth.test.json` : undefined,
    ),
    startBrowser: vi.fn(startBrowser),
    composeUp: vi.fn(async () => ({
      project: `cw-compose-${TOKEN}`,
      urls: { web: "http://localhost:4500", custodian: "x", mailpit: "y" },
      database: "postgres://app@localhost:7500/cognitive_wealth",
      passwordFile: `${WORKTREE}/.secrets/db_app_password`,
      ingested: [],
      notes: [],
    })),
    removeComposeProject: vi.fn((project: string) => `removed the Compose project ${project}`),
  } satisfies Verify;
  return { env, cli: createCli(dependencies({ verify: async () => env })) };
}

describe("cw verify stop", () => {
  it("stops this checkout's servers, then removes its --ref checkouts", async () => {
    const { env, cli } = fakeVerify();

    const { output, exitCode } = await run({ cli, argv: ["verify", "stop"] });

    expect(exitCode).toBe(0);
    expect(output).toEqual({
      servers: [41],
      refCheckouts: [REF_CHECKOUT],
      steps: [
        "stopped the verification server pid 41",
        `removed the --ref checkouts ${TOKEN}-1a2b3c4`,
      ],
      dryRun: false,
    });
    expect(env.stopVerifyServers).toHaveBeenCalledWith({ mainCheckout: "/repo", token: TOKEN });
    expect(env.removeRefCheckouts).toHaveBeenCalledWith({ mainCheckout: "/repo", token: TOKEN });
  });

  it("uses the main checkout's own token there", async () => {
    const { env, cli } = fakeVerify({ inMainCheckout: true });
    await run({ cli, argv: ["verify", "stop"] });
    expect(env.stopVerifyServers).toHaveBeenCalledWith({ mainCheckout: "/repo", token: "main" });
  });

  it("with --dry-run, lists what would go and touches nothing", async () => {
    const { env, cli } = fakeVerify();

    const { output, exitCode } = await run({ cli, argv: ["verify", "stop", "--dry-run"] });

    expect(exitCode).toBe(0);
    expect(output).toEqual({
      servers: [41],
      refCheckouts: [REF_CHECKOUT],
      steps: [],
      dryRun: true,
    });
    expect(env.stopVerifyServers).not.toHaveBeenCalled();
    expect(env.removeRefCheckouts).not.toHaveBeenCalled();
  });

  it("fails as stop_failed, with a retry, when a server won't exit", async () => {
    const { env, cli } = fakeVerify({
      stopVerifyServers: async () => {
        throw new Error("verification server (pid 41) won't exit");
      },
    });

    const { output, exitCode } = await run({ cli, argv: ["verify", "stop"] });

    expect(exitCode).toBe(1);
    expect(output).toMatchObject({
      code: "stop_failed",
      message: "verification server (pid 41) won't exit",
      retryable: true,
      cta: { commands: [{ command: "pnpm cw verify stop" }] },
    });
    expect(env.removeRefCheckouts).not.toHaveBeenCalled();
  });
});

describe("cw verify browser stop", () => {
  it("closes this checkout's session and frees the Chrome it holds", async () => {
    const { env, cli } = fakeVerify({ holder: TOKEN });

    const { output, exitCode } = await run({ cli, argv: ["verify", "browser", "stop"] });

    expect(exitCode).toBe(0);
    expect(output).toEqual({
      session: SESSION,
      holdsChrome: true,
      steps: [`closed the session ${SESSION}`, "stopped the shared Chrome (pid 42)"],
      dryRun: false,
    });
    expect(env.releaseChrome).toHaveBeenCalledWith({
      mainCheckout: "/repo",
      token: TOKEN,
      session: SESSION,
    });
  });

  it("closes a --session of its own, and says another checkout holds the Chrome", async () => {
    const { env, cli } = fakeVerify({ holder: "other_12345678" });

    const { output } = await run({
      cli,
      argv: ["verify", "browser", "stop", "--session", "persona-2", "--dry-run"],
    });

    expect(output).toEqual({ session: "persona-2", holdsChrome: false, steps: [], dryRun: true });
    expect(env.releaseChrome).not.toHaveBeenCalled();
  });
});

describe("cw verify start", () => {
  it("serves the working tree with cw's own seed and Ingestion, and points at signing in", async () => {
    const { env, cli } = fakeVerify();

    const { output, exitCode } = await run({ cli, argv: ["verify", "start"] });

    expect(exitCode).toBe(0);
    expect(output).toMatchObject({ ...STARTED, dryRun: false });
    expect(output.cta).toMatchObject({
      commands: [
        {
          command:
            "pnpm cw dev sign-in owner@cognitive-wealth.test --app http://localhost:3500 " +
            "--ip 10.77.0.1 --mailpit http://127.0.0.1:8026",
        },
        {
          command:
            "pnpm cw verify browser start owner@cognitive-wealth.test " +
            "--app http://localhost:3500 --ip 10.77.0.1",
        },
      ],
    });
    expect(env.startVerifyServer).toHaveBeenCalledWith({
      checkout: { mainCheckout: "/repo", top: WORKTREE, worktreeId: "feat-x" },
      ref: undefined,
      port: undefined,
      seed: undefined,
      domain: { seed: expect.any(Function), ingest: expect.any(Function) },
    });
  });

  it("passes --ref and --port, and --seed with its file resolved where it was typed", async () => {
    vi.stubEnv("INIT_CWD", "/typed/here");
    const { env, cli } = fakeVerify();

    await run({
      cli,
      argv: ["verify", "start", "--ref", "dev", "--port", "3999", "--seed", "h.ts:seedGrace"],
    });

    expect(env.startVerifyServer).toHaveBeenCalledWith(
      expect.objectContaining({ ref: "dev", port: 3999, seed: "/typed/here/h.ts:seedGrace" }),
    );
  });

  it("with --dry-run, checks the port and changes nothing", async () => {
    const { env, cli } = fakeVerify();

    const { output } = await run({ cli, argv: ["verify", "start", "--dry-run"] });

    expect(output).toMatchObject({ url: STARTED.url, replaces: 41, households: [], dryRun: true });
    expect(env.startVerifyServer).not.toHaveBeenCalled();
  });

  it.for(["port_taken", "unhealthy", "build_failed", "seed_conflict"])(
    "fails with the refusal's own code: %s",
    async (code) => {
      const { CliError } = await import("@repo/db/cli/cli-error");
      const { cli } = fakeVerify({
        startVerifyServer: async () => {
          throw new CliError({ code, message: "why" });
        },
      });

      const { output, exitCode } = await run({ cli, argv: ["verify", "start"] });

      expect(exitCode).toBe(1);
      expect(output).toMatchObject({ code, message: "why" });
    },
  );
});

describe("cw verify browser start", () => {
  const argv = [
    "verify",
    "browser",
    "start",
    "owner@cognitive-wealth.test",
    "--app",
    "http://localhost:3500",
    "--ip",
    "10.77.0.1",
  ];

  it("starts the browser for this checkout, and points at stopping it", async () => {
    const { env, cli } = fakeVerify();

    const { output, exitCode } = await run({ cli, argv });

    expect(exitCode).toBe(0);
    expect(output).toMatchObject({ session: SESSION, chrome: { pid: 9100 }, dryRun: false });
    expect(env.startBrowser).toHaveBeenCalledWith({
      checkout: { mainCheckout: "/repo", top: WORKTREE, worktreeId: "feat-x" },
      email: "owner@cognitive-wealth.test",
      app: "http://localhost:3500",
      ip: "10.77.0.1",
      session: undefined,
    });
  });

  it("refuses as no_session, with dev sign-in on the verification Mailpit as the next step", async () => {
    const { env, cli } = fakeVerify({ signedIn: false });

    const { output, exitCode } = await run({ cli, argv });

    expect(exitCode).toBe(1);
    expect(output).toMatchObject({
      code: "no_session",
      cta: {
        commands: [
          {
            command:
              "pnpm cw dev sign-in owner@cognitive-wealth.test --app http://localhost:3500 " +
              "--ip 10.77.0.1 --mailpit http://127.0.0.1:8026",
          },
        ],
      },
    });
    expect(env.startBrowser).not.toHaveBeenCalled();
  });

  it("fails as chrome_held, retryable, while another checkout holds the Chrome", async () => {
    const { CliError } = await import("@repo/db/cli/cli-error");
    const { cli } = fakeVerify({
      startBrowser: async () => {
        throw new CliError({ code: "chrome_held", message: "in use by /repo/.claude/worktrees/b" });
      },
    });

    const { output } = await run({ cli, argv });

    expect(output).toMatchObject({ code: "chrome_held", retryable: true });
  });

  it("with --dry-run, names the session file and the Chrome's holder", async () => {
    const { env, cli } = fakeVerify({ holder: "other_12345678" });

    const { output } = await run({ cli, argv: [...argv, "--dry-run"] });

    expect(output).toEqual({
      session: SESSION,
      statePath: `${WORKTREE}/.dev/auth/owner@cognitive-wealth.test.json`,
      holder: "other_12345678",
      dryRun: true,
    });
    expect(env.startBrowser).not.toHaveBeenCalled();
  });
});

describe("cw verify compose", () => {
  it("up starts the named services in this checkout's project, with cw's own seed", async () => {
    const { env, cli } = fakeVerify();

    const { output, exitCode } = await run({
      cli,
      argv: ["verify", "compose", "up", "migrate", "web"],
    });

    expect(exitCode).toBe(0);
    expect(output).toMatchObject({ project: `cw-compose-${TOKEN}`, dryRun: false });
    expect(env.composeUp).toHaveBeenCalledWith({
      checkout: { mainCheckout: "/repo", top: WORKTREE, worktreeId: "feat-x" },
      services: ["migrate", "web"],
      domain: { seed: expect.any(Function), ingest: expect.any(Function) },
    });
  });

  it("up with no service names starts them all", async () => {
    const { env, cli } = fakeVerify();
    await run({ cli, argv: ["verify", "compose", "up"] });
    expect(env.composeUp).toHaveBeenCalledWith(expect.objectContaining({ services: [] }));
  });

  it("down removes this checkout's project with its volumes", async () => {
    const { env, cli } = fakeVerify();

    const { output } = await run({ cli, argv: ["verify", "compose", "down"] });

    expect(output).toEqual({
      project: `cw-compose-${TOKEN}`,
      steps: [`removed the Compose project cw-compose-${TOKEN}`],
      dryRun: false,
    });
    expect(env.removeComposeProject).toHaveBeenCalledWith(`cw-compose-${TOKEN}`);
  });
});
