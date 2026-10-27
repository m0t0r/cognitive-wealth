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
};

/** This checkout's verifier state: one server and one --ref checkout. */
function fakeVerify({
  inMainCheckout = false,
  holder,
  stopVerifyServers = async () => "stopped the verification server pid 41",
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
