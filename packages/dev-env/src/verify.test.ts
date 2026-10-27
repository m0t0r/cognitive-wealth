import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { alive } from "./processes.ts";
import {
  chromeFiles,
  chromeHolder,
  refCheckoutsDir,
  refCheckoutsOf,
  releaseChrome,
  stateDirOf,
  stopVerifyServers,
  verifyServersOf,
} from "./verify.ts";

const TOKEN = "task_0ebb429f";

/** A main checkout of its own, only its `.dev/`, removed after the test. */
function mainCheckout() {
  const dir = mkdtempSync(join(tmpdir(), "cw-verify-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * A process `ps` shows as `node …/.next/standalone/apps/web/server.js`, as `start-app.sh`'s server
 * is before Next renames it, recorded in `token`'s state as `server-<role>.pid`.
 */
function startFakeServer({ main, role }: { main: string; role: string }) {
  const standalone = join(main, "app/apps/web/.next/standalone/apps/web");
  mkdirSync(standalone, { recursive: true });
  writeFileSync(join(standalone, "server.js"), "setInterval(() => {}, 1000);\n");
  // As `start-app.sh` runs it, `nohup node …`, so `ps` names it `node`, not node's full path.
  const child = spawn(process.execPath, [join(standalone, "server.js")], {
    argv0: "node",
    stdio: "ignore",
  });
  onTestFinished(() => {
    child.kill("SIGKILL");
  });
  const pid = child.pid ?? 0;
  const state = stateDirOf({ mainCheckout: main, token: TOKEN });
  mkdirSync(state, { recursive: true });
  writeFileSync(join(state, `server-${role}.pid`), `${pid}\n`);
  return pid;
}

describe("verifyServersOf and stopVerifyServers", () => {
  it("find and stop the recorded server, and remove the state", async () => {
    const main = mainCheckout();
    const pid = startFakeServer({ main, role: "head" });
    await vi.waitFor(() =>
      expect(verifyServersOf({ mainCheckout: main, token: TOKEN })).toEqual([pid]),
    );

    expect(await stopVerifyServers({ mainCheckout: main, token: TOKEN })).toBe(
      `stopped the verification server pid ${pid}`,
    );
    expect(alive(pid)).toBe(false);
    expect(verifyServersOf({ mainCheckout: main, token: TOKEN })).toEqual([]);
  });

  it("leave a recorded pid alone once it's some other process", async () => {
    const main = mainCheckout();
    const state = stateDirOf({ mainCheckout: main, token: TOKEN });
    mkdirSync(state, { recursive: true });
    // This test's own process: alive, but no web server.
    writeFileSync(join(state, "server-head.pid"), `${process.pid}\n`);

    expect(verifyServersOf({ mainCheckout: main, token: TOKEN })).toEqual([]);
    expect(await stopVerifyServers({ mainCheckout: main, token: TOKEN })).toBe(
      "no verification server was running",
    );
  });
});

describe("refCheckoutsOf", () => {
  it.for([
    { token: TOKEN, found: [`${TOKEN}-1a2b3c4`] },
    // The main checkout's token isn't a worktree's, but its checkouts are found all the same.
    { token: "main", found: ["main-5d6e7f8"] },
  ])("finds $token's --ref checkouts and no one else's", ({ token, found }) => {
    const main = mainCheckout();
    const dir = refCheckoutsDir(main);
    for (const name of [
      `${TOKEN}-1a2b3c4`,
      "main-5d6e7f8",
      "other_12345678-9abcdef",
      `${TOKEN}-x`,
    ]) {
      mkdirSync(join(dir, name), { recursive: true });
    }
    expect(refCheckoutsOf({ mainCheckout: main, token })).toEqual(
      found.map((name) => join(dir, name)),
    );
  });
});

describe("chromeHolder and releaseChrome", () => {
  it("leave another checkout's Chrome and its files alone", async () => {
    const main = mainCheckout();
    const files = chromeFiles(main);
    mkdirSync(join(main, ".dev/verify"), { recursive: true });
    writeFileSync(files.owner, "other_12345678\n/repo/.claude/worktrees/other\n");
    writeFileSync(files.pid, `${process.pid}\n`);

    expect(chromeHolder(main)).toBe("other_12345678");
    expect(
      await releaseChrome({ mainCheckout: main, token: TOKEN, session: "cw-verify-test-none" }),
    ).toBe("didn't hold the shared Chrome");
    expect(chromeHolder(main)).toBe("other_12345678");
  });

  it("free the Chrome this checkout holds, leaving a pid that's no longer Chrome running", async () => {
    const main = mainCheckout();
    const files = chromeFiles(main);
    mkdirSync(join(main, ".dev/verify"), { recursive: true });
    writeFileSync(files.owner, `${TOKEN}\n${main}\n`);
    writeFileSync(files.pid, `${process.pid}\n`);
    writeFileSync(files.profile, join(main, "profile"));

    expect(
      await releaseChrome({ mainCheckout: main, token: TOKEN, session: "cw-verify-test-none" }),
    ).toBe("released the shared Chrome");
    expect(chromeHolder(main)).toBeUndefined();
    expect(alive(process.pid)).toBe(true);
  });

  it("finds no holder without an owner file", () => {
    expect(chromeHolder(mainCheckout())).toBeUndefined();
  });
});
