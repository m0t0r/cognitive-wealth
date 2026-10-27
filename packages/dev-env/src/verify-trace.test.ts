import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { Cdp, CdpEvent } from "./cdp.ts";
import { verifyResources } from "./names.ts";
import type { TraceSummary } from "./trace-summary.ts";
import { TRACE_CATEGORIES, type TraceSystem, traceSession } from "./verify-trace.ts";

const ID = "feat-x";
const { session: SESSION } = verifyResources(ID);
const APP_PAGE = "http://localhost:3100/households";
const EVENTS = [{ name: "TracingStartedInBrowser", cat: "disabled-by-default-devtools.timeline" }];

function checkout() {
  const main = mkdtempSync(join(tmpdir(), "cw-verify-trace-"));
  onTestFinished(() => rmSync(main, { recursive: true, force: true }));
  return { mainCheckout: main, top: join(main, ".claude/worktrees/feat-x"), worktreeId: ID };
}

type FakeArgs = { viewport?: [number, number]; failOn?: string };

/** A browser with one page at APP_PAGE, answering what `traceSession` sends, and logging it. */
function fakeSystem({ viewport = [1280, 800], failOn }: FakeArgs = {}) {
  const log: string[] = [];
  const listeners = new Set<(event: CdpEvent) => void>();
  const emit = (method: string, params: Record<string, unknown> = {}) =>
    queueMicrotask(() => {
      for (const listener of listeners) listener({ method, params, sessionId: "page-1" });
    });
  const cdp: Cdp = {
    async send({ method, params = {}, sessionId }) {
      const detail =
        method === "Page.navigate" ? ` ${String(params.url)}` : method.startsWith("Emulation") || method === "Network.emulateNetworkConditions" ? ` ${JSON.stringify(params)}` : "";
      log.push(`${method}${detail}${sessionId ? ` @${sessionId}` : ""}`);
      if (method === failOn) throw new Error(`${method} failed`);
      switch (method) {
        case "Target.getTargets":
          return {
            targetInfos: [
              { targetId: "t-0", type: "page", url: "chrome://newtab/" },
              { targetId: "t-1", type: "page", url: APP_PAGE },
            ],
          };
        case "Target.attachToTarget":
          return { sessionId: "page-1" };
        case "Runtime.evaluate":
          return { result: { value: viewport } };
        case "Page.navigate":
          emit("Page.loadEventFired");
          return {};
        case "Tracing.start":
          log.push(`  categories ${JSON.stringify(params.traceConfig)}`);
          return {};
        case "Tracing.end":
          emit("Tracing.dataCollected", { value: EVENTS });
          emit("Tracing.tracingComplete");
          return {};
        default:
          return {};
      }
    },
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: () => log.push("close"),
  };
  const summary: TraceSummary = { url: APP_PAGE, cls: 0, insights: [] };
  const system: TraceSystem = {
    agentBrowser: vi.fn((args: string[]) => {
      log.push(`agent-browser ${args.join(" ")}`);
      if (args.includes("cdp-url")) return "ws://127.0.0.1:50000/devtools/browser/abc";
      if (args.includes("url")) return APP_PAGE;
      return "";
    }),
    connect: vi.fn(async () => cdp),
    summarize: vi.fn(async () => summary),
    sleep: vi.fn(async (ms: number) => {
      log.push(`sleep ${ms}`);
    }),
  };
  return { system, log, summary };
}

describe("traceSession", () => {
  it("traces a page load as the chrome-devtools MCP does, saves it gzipped, and summarizes it", async () => {
    const at = checkout();
    const { system, log, summary } = fakeSystem();

    const traced = await traceSession({ checkout: at, name: "households", steps: [], throttle: false, system });

    expect(system.connect).toHaveBeenCalledWith("ws://127.0.0.1:50000/devtools/browser/abc");
    expect(log).toEqual([
      `agent-browser --session ${SESSION} get url`,
      `agent-browser --session ${SESSION} get cdp-url`,
      "Target.getTargets",
      "Target.attachToTarget",
      "Runtime.evaluate @page-1",
      "Page.enable @page-1",
      "Page.navigate about:blank @page-1",
      "Tracing.start @page-1",
      `  categories ${JSON.stringify({ includedCategories: TRACE_CATEGORIES, excludedCategories: ["*"] })}`,
      `Page.navigate ${APP_PAGE} @page-1`,
      "sleep 5000",
      "Tracing.end @page-1",
      "close",
    ]);
    const file = join(at.top, ".dev/perf/households.trace.json.gz");
    expect(JSON.parse(gunzipSync(readFileSync(file)).toString())).toEqual({ traceEvents: EVENTS });
    expect(system.summarize).toHaveBeenCalledWith({ events: EVENTS, mode: "load" });
    expect(traced).toEqual({
      session: SESSION,
      url: APP_PAGE,
      mode: "load",
      throttled: false,
      viewport: { width: 1280, height: 800 },
      file,
      summary,
    });
  });

  it("refuses as wrong_viewport at any other window size, before recording", async () => {
    const { system, log } = fakeSystem({ viewport: [1280, 577] });

    await expect(
      traceSession({ checkout: checkout(), name: "x", steps: [], throttle: false, system }),
    ).rejects.toMatchObject({
      code: "wrong_viewport",
      message: expect.stringContaining(`agent-browser --session ${SESSION} set viewport 1280 800`),
    });
    expect(log).not.toContain("Tracing.start @page-1");
    expect(log.at(-1)).toBe("close");
  });

  it("throttles the page for the whole trace, then turns throttling off", async () => {
    const { system, log } = fakeSystem();

    const traced = await traceSession({ checkout: checkout(), name: "x", steps: [], throttle: true, system });

    const throttling = log.filter((line) => line.startsWith("Emulation") || line.startsWith("Network.emulate"));
    expect(throttling).toEqual([
      'Emulation.setCPUThrottlingRate {"rate":4} @page-1',
      'Network.emulateNetworkConditions {"offline":false,"latency":562.5,"downloadThroughput":180000,"uploadThroughput":84375} @page-1',
      'Emulation.setCPUThrottlingRate {"rate":1} @page-1',
      'Network.emulateNetworkConditions {"offline":false,"latency":0,"downloadThroughput":-1,"uploadThroughput":-1} @page-1',
    ]);
    expect(log.indexOf(throttling[1]!)).toBeLessThan(log.indexOf("Tracing.start @page-1"));
    expect(log.indexOf(throttling[2]!)).toBeGreaterThan(log.indexOf("Tracing.end @page-1"));
    expect(traced.throttled).toBe(true);
  });

  it("turns throttling off when the trace fails", async () => {
    const { system, log } = fakeSystem({ failOn: "Tracing.start" });

    await expect(
      traceSession({ checkout: checkout(), name: "x", steps: [], throttle: true, system }),
    ).rejects.toThrow("Tracing.start failed");
    expect(log.slice(-3)).toEqual([
      'Emulation.setCPUThrottlingRate {"rate":1} @page-1',
      'Network.emulateNetworkConditions {"offline":false,"latency":0,"downloadThroughput":-1,"uploadThroughput":-1} @page-1',
      "close",
    ]);
  });

  it("with steps, records them on the current page without reloading it", async () => {
    const { system, log } = fakeSystem();

    const traced = await traceSession({
      checkout: checkout(),
      name: "x",
      steps: ["click @e3", 'fill @e4 "Grace Hopper"'],
      throttle: false,
      system,
    });

    expect(log.slice(log.indexOf("Tracing.start @page-1"))).toEqual([
      "Tracing.start @page-1",
      `  categories ${JSON.stringify({ includedCategories: TRACE_CATEGORIES, excludedCategories: ["*"] })}`,
      `agent-browser --session ${SESSION} click @e3`,
      `agent-browser --session ${SESSION} fill @e4 Grace Hopper`,
      "sleep 1000",
      "Tracing.end @page-1",
      "close",
    ]);
    expect(log.some((line) => line.startsWith("Page.navigate"))).toBe(false);
    expect(system.summarize).toHaveBeenCalledWith({ events: EVENTS, mode: "interaction" });
    expect(traced.mode).toBe("interaction");
  });
});
