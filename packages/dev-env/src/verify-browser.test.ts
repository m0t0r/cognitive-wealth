import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyResources } from "./names.ts";
import { type BrowserSystem, startBrowser } from "./verify-browser.ts";

const ID = "feat-x";
const { session: SESSION } = verifyResources(ID);
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

function fakeSystem() {
  const calls: string[] = [];
  const system: BrowserSystem = {
    agentBrowser: vi.fn((args: string[]) => {
      calls.push(`agent-browser ${args.join(" ")}`);
    }),
  };
  return { system, calls };
}

describe("startBrowser", () => {
  it("opens the app signed in, in the session's own Chrome, at the trace window size", async () => {
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

    expect(started).toEqual({
      session: SESSION,
      statePath,
      viewport: { width: 1280, height: 800 },
    });
    // A fresh session each time: --state on a running one leaves it blank (#225). No --cdp, so
    // agent-browser launches a Chrome of the session's own.
    expect(calls).toEqual([
      `agent-browser --session ${SESSION} close`,
      `agent-browser --session ${SESSION} --state ${statePath} --headers {"x-forwarded-for":"10.77.0.1"} open ${APP}`,
      `agent-browser --session ${SESSION} set viewport 1280 800`,
    ]);
  });

  it("starts even when the session wasn't running", async () => {
    const { system, calls } = fakeSystem();
    system.agentBrowser = vi.fn((args: string[]) => {
      if (args.includes("close")) throw new Error("no such session");
      calls.push(args.at(-2) ?? "");
    });

    await startBrowser({ checkout: checkouts(), email: EMAIL, app: APP, ip: "10.77.0.1", system });

    expect(calls).toEqual(["open", "1280"]);
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
    expect(system.agentBrowser).not.toHaveBeenCalled();
  });
});
