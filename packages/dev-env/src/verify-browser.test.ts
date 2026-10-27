import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyResources } from "./names.ts";
import { type BrowserSystem, startBrowser } from "./verify-browser.ts";
import { chromeFiles, verifyDir } from "./verify.ts";

const ID = "feat-x";
const { token: TOKEN, session: SESSION } = verifyResources(ID);
const EMAIL = "owner@cognitive-wealth.test";
const APP = "http://localhost:3100";

/** A main checkout with this worktree inside it, removed after the test. */
function checkouts({ signedIn = "worktree" }: { signedIn?: "worktree" | "main" | "none" } = {}) {
  const main = mkdtempSync(join(tmpdir(), "cw-verify-browser-"));
  onTestFinished(() => rmSync(main, { recursive: true, force: true }));
  const top = join(main, ".claude/worktrees/feat-x");
  if (signedIn !== "none") {
    const auth = join(signedIn === "main" ? main : top, ".dev/auth");
    mkdirSync(auth, { recursive: true });
    writeFileSync(join(auth, `${EMAIL}.json`), "{}");
  }
  return { mainCheckout: main, top, worktreeId: ID };
}

/** Records the shared Chrome as `owner`'s (a token and its checkout's path), with pid 9000. */
function recordChrome({ main, owner }: { main: string; owner?: [string, string] }) {
  const files = chromeFiles(main);
  mkdirSync(verifyDir(main), { recursive: true });
  writeFileSync(files.pid, "9000\n");
  writeFileSync(files.profile, "/tmp/chrome-profile\n");
  if (owner) writeFileSync(files.owner, `${owner.join("\n")}\n`);
}

type FakeArgs = { listener?: number; live?: string[] };

function fakeSystem({ listener, live = [] }: FakeArgs = {}) {
  const calls: string[] = [];
  const system: BrowserSystem = {
    listenerOn: () => listener,
    commandOf: (pid) => `/Applications/Thing --pid ${pid}`,
    liveCheckouts: () => live,
    stopChrome: vi.fn(async () => {
      calls.push("stop chrome");
      return "stopped the shared Chrome (pid 9000)";
    }),
    launchChrome: vi.fn(async () => {
      calls.push("launch chrome");
      return { pid: 9100, profile: "/tmp/new-profile" };
    }),
    agentBrowser: vi.fn((args: string[]) => {
      calls.push(`agent-browser ${args.join(" ")}`);
    }),
    sleep: async () => {},
  };
  return { system, calls };
}

describe("startBrowser", () => {
  it("starts the shared Chrome, records this checkout as its holder, and opens the app signed in", async () => {
    const checkout = checkouts();
    const { system, calls } = fakeSystem();
    const statePath = join(checkout.top, `.dev/auth/${EMAIL}.json`);

    const started = await startBrowser({
      checkout,
      email: EMAIL,
      app: APP,
      ip: "10.77.0.1",
      system,
    });

    expect(started).toEqual({ session: SESSION, statePath, chrome: { pid: 9100, started: true } });
    expect(calls).toEqual([
      "launch chrome",
      `agent-browser --session ${SESSION} connect 9222`,
      `agent-browser --session ${SESSION} state load ${statePath}`,
      `agent-browser --session ${SESSION} --headers {"x-forwarded-for":"10.77.0.1"} open ${APP}`,
    ]);
    const files = chromeFiles(checkout.mainCheckout);
    expect(readFileSync(files.pid, "utf8").trim()).toBe("9100");
    expect(readFileSync(files.profile, "utf8").trim()).toBe("/tmp/new-profile");
    expect(readFileSync(files.owner, "utf8")).toBe(`${TOKEN}\n${checkout.top}\n`);
    expect(existsSync(join(verifyDir(checkout.mainCheckout), "chrome.starting"))).toBe(false);
  });

  it("falls back to the main checkout's session file, and takes a --session", async () => {
    const checkout = checkouts({ signedIn: "main" });
    const { system } = fakeSystem();

    const started = await startBrowser({
      checkout,
      email: EMAIL,
      app: APP,
      ip: "10.77.0.2",
      session: "persona-2",
      system,
    });

    expect(started).toMatchObject({
      session: "persona-2",
      statePath: join(checkout.mainCheckout, `.dev/auth/${EMAIL}.json`),
    });
  });

  it("refuses as no_session without a session file", async () => {
    const { system } = fakeSystem();

    await expect(
      startBrowser({
        checkout: checkouts({ signedIn: "none" }),
        email: EMAIL,
        app: APP,
        ip: "10.77.0.1",
        system,
      }),
    ).rejects.toMatchObject({ code: "no_session" });
    expect(system.launchChrome).not.toHaveBeenCalled();
  });

  it("reuses the Chrome this checkout holds", async () => {
    const checkout = checkouts();
    recordChrome({ main: checkout.mainCheckout, owner: [TOKEN, checkout.top] });
    const { system, calls } = fakeSystem({ listener: 9000 });

    const started = await startBrowser({
      checkout,
      email: EMAIL,
      app: APP,
      ip: "10.77.0.1",
      system,
    });

    expect(started.chrome).toEqual({ pid: 9000, started: false });
    expect(calls[0]).toBe(`agent-browser --session ${SESSION} connect 9222`);
  });

  it("refuses as port_9222_taken when a Chrome it didn't start listens there", async () => {
    const checkout = checkouts();
    const { system } = fakeSystem({ listener: 555 });

    await expect(
      startBrowser({ checkout, email: EMAIL, app: APP, ip: "10.77.0.1", system }),
    ).rejects.toMatchObject({
      code: "port_9222_taken",
      message: expect.stringContaining("pid 555: /Applications/Thing --pid 555"),
    });
    expect(system.launchChrome).not.toHaveBeenCalled();
    expect(existsSync(join(verifyDir(checkout.mainCheckout), "chrome.starting"))).toBe(false);
  });

  it("refuses as chrome_held, naming the holder, while another live checkout holds it", async () => {
    const checkout = checkouts();
    const other = join(checkout.mainCheckout, ".claude/worktrees/other");
    recordChrome({ main: checkout.mainCheckout, owner: ["other_12345678", other] });
    const { system } = fakeSystem({ listener: 9000, live: [checkout.mainCheckout, other] });

    await expect(
      startBrowser({ checkout, email: EMAIL, app: APP, ip: "10.77.0.1", system }),
    ).rejects.toMatchObject({ code: "chrome_held", message: expect.stringContaining(other) });
    expect(system.stopChrome).not.toHaveBeenCalled();
  });

  it("refuses as chrome_held when the Chrome has no recorded holder", async () => {
    const checkout = checkouts();
    recordChrome({ main: checkout.mainCheckout });
    const { system } = fakeSystem({ listener: 9000 });

    await expect(
      startBrowser({ checkout, email: EMAIL, app: APP, ip: "10.77.0.1", system }),
    ).rejects.toMatchObject({ code: "chrome_held" });
  });

  it("takes over from a holder that's gone, with a fresh Chrome", async () => {
    const checkout = checkouts();
    const gone = join(checkout.mainCheckout, ".claude/worktrees/gone");
    recordChrome({ main: checkout.mainCheckout, owner: ["gone_12345678", gone] });
    const { system, calls } = fakeSystem({ listener: 9000, live: [checkout.mainCheckout] });

    const started = await startBrowser({
      checkout,
      email: EMAIL,
      app: APP,
      ip: "10.77.0.1",
      system,
    });

    expect(calls.slice(0, 2)).toEqual(["stop chrome", "launch chrome"]);
    expect(started.chrome).toEqual({ pid: 9100, started: true, tookOverFrom: gone });
  });

  it("waits for another start to finish, then refuses as chrome_starting", async () => {
    const checkout = checkouts();
    mkdirSync(join(verifyDir(checkout.mainCheckout), "chrome.starting"), { recursive: true });
    const { system } = fakeSystem();

    await expect(
      startBrowser({ checkout, email: EMAIL, app: APP, ip: "10.77.0.1", system }),
    ).rejects.toMatchObject({ code: "chrome_starting" });
    expect(system.launchChrome).not.toHaveBeenCalled();
    // Another start's lock: never this one's to remove.
    expect(existsSync(join(verifyDir(checkout.mainCheckout), "chrome.starting"))).toBe(true);
  });

  it("frees the lock when a step fails", async () => {
    const checkout = checkouts();
    const { system } = fakeSystem();
    system.agentBrowser = () => {
      throw new Error("no such command");
    };

    await expect(
      startBrowser({ checkout, email: EMAIL, app: APP, ip: "10.77.0.1", system }),
    ).rejects.toThrow("no such command");
    expect(existsSync(join(verifyDir(checkout.mainCheckout), "chrome.starting"))).toBe(false);
  });
});
