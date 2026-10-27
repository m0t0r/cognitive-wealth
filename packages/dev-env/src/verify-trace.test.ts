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
const CATEGORIES = `  categories ${JSON.stringify({ includedCategories: TRACE_CATEGORIES, excludedCategories: ["*"] })}`;

function checkout() {
  const main = mkdtempSync(join(tmpdir(), "cw-verify-trace-"));
  onTestFinished(() => rmSync(main, { recursive: true, force: true }));
  return { mainCheckout: main, top: join(main, ".claude/worktrees/feat-x"), worktreeId: ID };
}

type FakeArgs = {
  /** The session's page: its window size and pixel ratio. */
  viewport?: [number, number, number];
  /** The trace tab's `document.visibilityState`. */
  visibility?: string;
  failOn?: string;
  /** A command Chrome never answers. */
  hangOn?: string;
};

/**
 * A browser with agent-browser's page at APP_PAGE (session `page-1`) and, once created, the trace's
 * own tab (session `trace-1`), answering what `traceSession` sends and logging it.
 */
function fakeSystem({
  viewport = [1280, 800, 2],
  visibility = "visible",
  failOn,
  hangOn,
}: FakeArgs = {}) {
  const log: string[] = [];
  const listeners = new Set<(event: CdpEvent) => void>();
  const emit = ({ method, sessionId, params = {} }: CdpEvent) =>
    queueMicrotask(() => {
      for (const listener of listeners) listener({ method, params, sessionId });
    });
  const cdp: Cdp = {
    async send({ method, params = {}, sessionId }) {
      const shown = ["Target.createTarget", "Page.navigate", "Network.emulateNetworkConditions"];
      const detail =
        method.startsWith("Emulation") || shown.includes(method) ? ` ${JSON.stringify(params)}` : "";
      log.push(`${method}${detail}${sessionId ? ` @${sessionId}` : ""}`);
      if (method === failOn) throw new Error(`${method} failed`);
      if (method === hangOn) return new Promise(() => {});
      switch (method) {
        case "Target.getTargets":
          return {
            targetInfos: [
              { targetId: "t-0", type: "page", url: "chrome://newtab/", browserContextId: "c-0" },
              { targetId: "t-1", type: "page", url: APP_PAGE, browserContextId: "c-1" },
            ],
          };
        case "Target.createTarget":
          return { targetId: "t-2" };
        case "Target.attachToTarget":
          return { sessionId: params.targetId === "t-2" ? "trace-1" : "page-1" };
        case "Runtime.evaluate":
          if (sessionId === "page-1") return { result: { value: viewport } };
          return {
            result: {
              value: String(params.expression).includes("visibilityState")
                ? visibility
                : { lcpMs: 88, cls: 0.012 },
            },
          };
        case "Page.navigate":
          emit({ method: "Page.loadEventFired", params: {}, sessionId });
          return {};
        case "Tracing.start":
          log.push(CATEGORIES);
          return {};
        case "Tracing.end":
          emit({ method: "Tracing.dataCollected", params: { value: EVENTS }, sessionId });
          emit({ method: "Tracing.tracingComplete", params: {}, sessionId });
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
    stepTimeoutMs: 50,
  };
  return { system, log, summary };
}

describe("traceSession", () => {
  it("traces a page load in a tab of its own, as the chrome-devtools MCP does, and summarizes it", async () => {
    const at = checkout();
    const { system, log, summary } = fakeSystem();

    const traced = await traceSession({
      checkout: at,
      name: "households",
      steps: [],
      throttle: false,
      system,
    });

    expect(system.connect).toHaveBeenCalledWith("ws://127.0.0.1:50000/devtools/browser/abc");
    expect(log).toEqual([
      `agent-browser --session ${SESSION} get url`,
      `agent-browser --session ${SESSION} get cdp-url`,
      "Target.getTargets",
      "Target.attachToTarget",
      "Runtime.evaluate @page-1",
      // Its own tab in the session's browser context (its cookies), so agent-browser's tab is never
      // navigated behind its back.
      'Target.createTarget {"url":"about:blank","browserContextId":"c-1"}',
      "Target.attachToTarget",
      'Emulation.setDeviceMetricsOverride {"width":1280,"height":800,"deviceScaleFactor":2,"mobile":false} @trace-1',
      "Page.enable @trace-1",
      "Page.bringToFront @trace-1",
      "Runtime.evaluate @trace-1",
      "Tracing.start @trace-1",
      CATEGORIES,
      `Page.navigate {"url":"${APP_PAGE}"} @trace-1`,
      "sleep 5000",
      "Tracing.end @trace-1",
      // The browser's own LCP and layout-shift entries for the same load, a second reading.
      "Runtime.evaluate @trace-1",
      "Target.closeTarget",
      "Page.bringToFront @page-1",
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
      browserApi: { lcpMs: 88, cls: 0.012 },
    });
  });

  it("refuses as hidden_tab when its tab isn't visible, since Chrome records no LCP then", async () => {
    const { system, log } = fakeSystem({ visibility: "hidden" });

    await expect(
      traceSession({ checkout: checkout(), name: "x", steps: [], throttle: false, system }),
    ).rejects.toMatchObject({ code: "hidden_tab" });
    expect(log).not.toContain("Tracing.start @trace-1");
    expect(log.slice(-3)).toEqual(["Target.closeTarget", "Page.bringToFront @page-1", "close"]);
  });

  it("throttles the trace's tab for the whole trace, then turns throttling off", async () => {
    const { system, log } = fakeSystem();

    const traced = await traceSession({
      checkout: checkout(),
      name: "x",
      steps: [],
      throttle: true,
      system,
    });

    const throttling = log.filter(
      (line) =>
        line.startsWith("Emulation.setCPU") || line.startsWith("Network.emulateNetworkConditions"),
    );
    expect(throttling).toEqual([
      'Emulation.setCPUThrottlingRate {"rate":4} @trace-1',
      'Network.emulateNetworkConditions {"offline":false,"latency":562.5,"downloadThroughput":180000,"uploadThroughput":84375} @trace-1',
      'Emulation.setCPUThrottlingRate {"rate":1} @trace-1',
      'Network.emulateNetworkConditions {"offline":false,"latency":0,"downloadThroughput":-1,"uploadThroughput":-1} @trace-1',
    ]);
    expect(log.indexOf(throttling[1]!)).toBeLessThan(log.indexOf("Tracing.start @trace-1"));
    expect(log.indexOf(throttling[2]!)).toBeGreaterThan(log.indexOf("Tracing.end @trace-1"));
    expect(traced.throttled).toBe(true);
  });

  it("turns throttling off and closes its tab when the trace fails", async () => {
    const { system, log } = fakeSystem({ failOn: "Tracing.start" });

    await expect(
      traceSession({ checkout: checkout(), name: "x", steps: [], throttle: true, system }),
    ).rejects.toThrow("Tracing.start failed");
    expect(log.slice(-5)).toEqual([
      'Emulation.setCPUThrottlingRate {"rate":1} @trace-1',
      'Network.emulateNetworkConditions {"offline":false,"latency":0,"downloadThroughput":-1,"uploadThroughput":-1} @trace-1',
      "Target.closeTarget",
      "Page.bringToFront @page-1",
      "close",
    ]);
  });

  it("refuses as trace_timeout when Chrome stops answering, and still cleans up", async () => {
    // Seen with a throttled load that never committed: the trace waited for 31 minutes.
    const { system, log } = fakeSystem({ hangOn: "Page.navigate" });

    await expect(
      traceSession({ checkout: checkout(), name: "x", steps: [], throttle: true, system }),
    ).rejects.toMatchObject({
      code: "trace_timeout",
      message: expect.stringContaining("took over 0.05 s"),
    });
    expect(log.slice(-5)).toEqual([
      'Emulation.setCPUThrottlingRate {"rate":1} @trace-1',
      'Network.emulateNetworkConditions {"offline":false,"latency":0,"downloadThroughput":-1,"uploadThroughput":-1} @trace-1',
      "Target.closeTarget",
      "Page.bringToFront @page-1",
      "close",
    ]);
  });

  it("with steps, records them in agent-browser's tab without reloading it", async () => {
    const { system, log } = fakeSystem();

    const traced = await traceSession({
      checkout: checkout(),
      name: "x",
      steps: ["click @e3", 'fill @e4 "Grace Hopper"'],
      throttle: false,
      system,
    });

    expect(log.slice(log.indexOf("Runtime.evaluate @page-1"))).toEqual([
      "Runtime.evaluate @page-1",
      "Tracing.start @page-1",
      CATEGORIES,
      `agent-browser --session ${SESSION} click @e3`,
      `agent-browser --session ${SESSION} fill @e4 Grace Hopper`,
      "sleep 1000",
      "Tracing.end @page-1",
      "close",
    ]);
    expect(system.summarize).toHaveBeenCalledWith({ events: EVENTS, mode: "interaction" });
    expect(traced.mode).toBe("interaction");
  });

  it("refuses an interaction trace as wrong_viewport at any other window size", async () => {
    const { system, log } = fakeSystem({ viewport: [1280, 577, 2] });

    await expect(
      traceSession({ checkout: checkout(), name: "x", steps: ["click @e3"], throttle: false, system }),
    ).rejects.toMatchObject({
      code: "wrong_viewport",
      message: expect.stringContaining(`agent-browser --session ${SESSION} set viewport 1280 800`),
    });
    expect(log).not.toContain("Tracing.start @page-1");
    expect(log.at(-1)).toBe("close");
  });
});
