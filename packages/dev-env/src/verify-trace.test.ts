import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { Cdp, CdpEvent, SendArgs } from "./cdp.ts";
import { verifyResources } from "./names.ts";
import type { TraceSummary } from "./trace-summary.ts";
import { TRACE_CATEGORIES, type TraceSystem, traceSession } from "./verify-trace.ts";

const ID = "feat-x";
const { session: SESSION } = verifyResources(ID);
const APP_PAGE = "http://localhost:3100/households";
const EVENTS = [{ name: "TracingStartedInBrowser", cat: "disabled-by-default-devtools.timeline" }];
const COOKIE = { name: "better-auth.session_token", value: "abc", domain: "localhost", path: "/" };
const CATEGORIES = `  categories ${JSON.stringify({ includedCategories: TRACE_CATEGORIES, excludedCategories: ["*"] })}`;
const THROTTLE_ON = [
  'Emulation.setCPUThrottlingRate {"rate":4} @trace-1',
  "Network.enable @trace-1",
  'Network.emulateNetworkConditions {"offline":false,"latency":562.5,"downloadThroughput":180000,"uploadThroughput":84375} @trace-1',
];

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
  /** How many of the Chromes it launches stall on loading the page, as Chrome can when throttled. */
  stallingChromes?: number;
  /** The browser contexts created in agent-browser's browser; its default one is never listed. */
  contexts?: string[];
  /** Whether CPU throttling slows the page's work down, which Chrome doesn't always do. */
  throttlingApplies?: boolean;
};

/**
 * agent-browser's browser, with its page at APP_PAGE (session `page-1`), and the Chromes a page-load
 * trace launches, each with its tab (session `trace-1`), answering what `traceSession` sends and
 * logging it. They're one fake: the log's order and sessions tell them apart.
 */
function fakeSystem({
  viewport = [1280, 800, 2],
  visibility = "visible",
  failOn,
  hangOn,
  stallingChromes = 0,
  contexts = ["c-1"],
  throttlingApplies = true,
}: FakeArgs = {}) {
  const log: string[] = [];
  let launched = 0;
  let cpuRate = 1;
  const listeners = new Set<(event: CdpEvent) => void>();
  const emit = ({ method, sessionId, params }: CdpEvent) =>
    queueMicrotask(() => {
      for (const listener of listeners) listener({ method, params, sessionId });
    });
  const shown = new Set([
    "Target.createTarget",
    "Page.navigate",
    "Network.emulateNetworkConditions",
    "Storage.getCookies",
    "Storage.setCookies",
  ]);
  const answer = async ({
    method,
    params = {},
    sessionId,
  }: SendArgs): Promise<Record<string, unknown>> => {
    const expression = typeof params.expression === "string" ? params.expression : "";
    const calibration = method === "Runtime.evaluate" && expression.includes("performance.now");
    const detail =
      method.startsWith("Emulation") || shown.has(method)
        ? ` ${JSON.stringify(params)}`
        : calibration
          ? " (timed work)"
          : "";
    log.push(`${method}${detail}${sessionId ? ` @${sessionId}` : ""}`);
    if (method === failOn) throw new Error(`${method} failed`);
    if (method === hangOn) return new Promise(() => {});
    if (method === "Page.navigate" && params.url === APP_PAGE && launched <= stallingChromes) {
      // Committed, but the load event never comes.
      return {};
    }
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
      case "Target.getBrowserContexts":
        return { browserContextIds: contexts };
      case "Storage.getCookies":
        return { cookies: [COOKIE] };
      case "Target.attachToTarget":
        return { sessionId: params.targetId === "t-2" ? "trace-1" : "page-1" };
      case "Emulation.setCPUThrottlingRate":
        cpuRate = Number(params.rate);
        return {};
      case "Runtime.evaluate":
        if (calibration) {
          return { result: { value: throttlingApplies ? 40 * cpuRate : 40 } };
        }
        if (sessionId === "page-1") return { result: { value: viewport } };
        return {
          result: {
            value: expression.includes("visibilityState") ? visibility : { lcpMs: 88, cls: 0.012 },
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
  };
  const cdp: Cdp = {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fake answers each method as Chrome would
    send: answer as Cdp["send"],
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
    connect: vi.fn(async (url: string) => {
      log.push(`connect ${url}`);
      return cdp;
    }),
    launchChrome: vi.fn(async () => {
      launched += 1;
      cpuRate = 1;
      log.push("launch chrome");
      return {
        endpoint: "ws://127.0.0.1:60000/devtools/browser/own",
        stop: async () => {
          log.push("stop chrome");
        },
      };
    }),
    summarize: vi.fn(async () => summary),
    sleep: vi.fn(async (ms: number) => {
      log.push(`sleep ${ms}`);
    }),
    stepTimeoutMs: 50,
  };
  return { system, log, summary };
}

describe("traceSession", () => {
  it("traces a page load in a Chrome of its own, signed in, as the chrome-devtools MCP does", async () => {
    const at = checkout();
    const { system, log, summary } = fakeSystem();

    const traced = await traceSession({
      checkout: at,
      name: "households",
      steps: [],
      throttle: false,
      system,
    });

    expect(log).toEqual([
      `agent-browser --session ${SESSION} get url`,
      `agent-browser --session ${SESSION} get cdp-url`,
      "connect ws://127.0.0.1:50000/devtools/browser/abc",
      "Target.getTargets",
      "Target.attachToTarget",
      "Runtime.evaluate @page-1",
      // The session's cookies, so the trace is signed in as the session is.
      "Target.getBrowserContexts",
      'Storage.getCookies {"browserContextId":"c-1"}',
      "close",
      // A Chrome of its own, nothing else attached: agent-browser makes any new tab in its browser
      // its active one.
      "launch chrome",
      "connect ws://127.0.0.1:60000/devtools/browser/own",
      `Storage.setCookies {"cookies":[${JSON.stringify(COOKIE)}]}`,
      'Target.createTarget {"url":"about:blank"}',
      "Target.attachToTarget",
      'Emulation.setDeviceMetricsOverride {"width":1280,"height":800,"deviceScaleFactor":2,"mobile":false} @trace-1',
      "Page.enable @trace-1",
      "Page.bringToFront @trace-1",
      "Runtime.evaluate @trace-1",
      // The MCP's starting point, a tab already on the page, then its sequence: about:blank, the
      // trace started, the page loaded, 5 s.
      `Page.navigate {"url":"${APP_PAGE}"} @trace-1`,
      'Page.navigate {"url":"about:blank"} @trace-1',
      "Tracing.start @trace-1",
      CATEGORIES,
      `Page.navigate {"url":"${APP_PAGE}"} @trace-1`,
      "sleep 5000",
      "Tracing.end @trace-1",
      // The browser's own LCP and layout-shift entries for the same load, a second reading.
      "Runtime.evaluate @trace-1",
      "close",
      "stop chrome",
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
      attempts: 1,
    });
  });

  it("reads the cookies of Chrome's default context without naming it, which Chrome refuses", async () => {
    // agent-browser's own Chrome keeps its tab in the default context: naming its id failed every
    // trace with "Failed to find browser context".
    const { system, log } = fakeSystem({ contexts: [] });

    await traceSession({ checkout: checkout(), name: "x", steps: [], throttle: false, system });

    expect(log).toContain("Storage.getCookies {}");
    expect(log).toContain(`Storage.setCookies {"cookies":[${JSON.stringify(COOKIE)}]}`);
  });

  it("refuses as hidden_tab when its tab isn't visible, since Chrome records no LCP then", async () => {
    const { system, log } = fakeSystem({ visibility: "hidden" });

    await expect(
      traceSession({ checkout: checkout(), name: "x", steps: [], throttle: false, system }),
    ).rejects.toMatchObject({ code: "hidden_tab" });
    expect(log).not.toContain("Tracing.start @trace-1");
    expect(log.slice(-2)).toEqual(["close", "stop chrome"]);
  });

  it("throttles the traced load, and measures that the throttling slowed the page down", async () => {
    // Chrome doesn't always apply it: the MCP's "4x CPU" traces did the unthrottled amount of work.
    const { system, log } = fakeSystem();

    const traced = await traceSession({
      checkout: checkout(),
      name: "x",
      steps: [],
      throttle: true,
      system,
    });

    const blank = log.indexOf('Page.navigate {"url":"about:blank"} @trace-1');
    expect(log.slice(blank - 3, blank)).toEqual([
      `Page.navigate {"url":"${APP_PAGE}"} @trace-1`,
      // A fixed piece of work timed unthrottled, twice for a settled JIT.
      "Runtime.evaluate (timed work) @trace-1",
      "Runtime.evaluate (timed work) @trace-1",
    ]);
    expect(log.slice(blank + 1, blank + 4)).toEqual(THROTTLE_ON);
    const end = log.indexOf("Tracing.end @trace-1");
    expect(log.slice(end + 1)).toEqual([
      "Runtime.evaluate (timed work) @trace-1",
      "Runtime.evaluate (timed work) @trace-1",
      "Runtime.evaluate @trace-1",
      // Its Chrome is thrown away, so the throttling isn't turned off first.
      "close",
      "stop chrome",
    ]);
    expect(traced).toMatchObject({ throttled: true, cpuSlowdown: 4, attempts: 1 });
  });

  it("refuses as throttle_not_applied when the page's work didn't slow down", async () => {
    const { system } = fakeSystem({ throttlingApplies: false });

    await expect(
      traceSession({ checkout: checkout(), name: "x", steps: [], throttle: true, system }),
    ).rejects.toMatchObject({
      code: "throttle_not_applied",
      message: expect.stringContaining("1×"),
    });
  });

  it("retries a page load Chrome stalled on in a fresh Chrome, and says how many it took", async () => {
    // Chrome 147 stalled 4 throttled traced loads in 10 (156: 2 in 12): committed, idle, no load.
    const { system, log } = fakeSystem({ stallingChromes: 2 });

    const traced = await traceSession({
      checkout: checkout(),
      name: "x",
      steps: [],
      throttle: true,
      system,
    });

    expect(log.filter((line) => line === "launch chrome")).toHaveLength(3);
    expect(log.filter((line) => line === "stop chrome")).toHaveLength(3);
    expect(traced.attempts).toBe(3);
  });

  it("gives up as trace_timeout after three stalled Chromes", async () => {
    const { system, log } = fakeSystem({ stallingChromes: 3 });

    await expect(
      traceSession({ checkout: checkout(), name: "x", steps: [], throttle: true, system }),
    ).rejects.toMatchObject({
      code: "trace_timeout",
      message: expect.stringContaining("3 tries"),
    });
    expect(log.filter((line) => line === "stop chrome")).toHaveLength(3);
  });

  it("doesn't retry a refusal that isn't a stall", async () => {
    const { system, log } = fakeSystem({ failOn: "Tracing.start" });

    await expect(
      traceSession({ checkout: checkout(), name: "x", steps: [], throttle: true, system }),
    ).rejects.toThrow("Tracing.start failed");
    expect(log.filter((line) => line === "launch chrome")).toHaveLength(1);
    expect(log.slice(-2)).toEqual(["close", "stop chrome"]);
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

    expect(system.launchChrome).not.toHaveBeenCalled();
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
    expect(traced).toMatchObject({ mode: "interaction", attempts: 1 });
  });

  it("throttles steps in agent-browser's tab, then turns it off there, even after a failure", async () => {
    const { system, log } = fakeSystem({ hangOn: "Tracing.end" });

    await expect(
      traceSession({
        checkout: checkout(),
        name: "x",
        steps: ["click @e3"],
        throttle: true,
        system,
      }),
    ).rejects.toMatchObject({
      code: "trace_timeout",
      message: expect.stringContaining("took over"),
    });
    expect(log.slice(-3)).toEqual([
      'Emulation.setCPUThrottlingRate {"rate":1} @page-1',
      'Network.emulateNetworkConditions {"offline":false,"latency":0,"downloadThroughput":-1,"uploadThroughput":-1} @page-1',
      "close",
    ]);
  });

  it("reports the first failure, not a cleanup step's that came after it", async () => {
    // Seen with a throttled trace: a step timed out, then so did turning the throttling off, and
    // the second hid the first.
    const { system } = fakeSystem({ hangOn: "Tracing.end" });
    const connect = vi.spyOn(system, "connect");
    connect.mockImplementation(async () => {
      const cdp = await fakeSystem({ hangOn: "Tracing.end" }).system.connect("ws://x");
      return {
        ...cdp,
        send: <T>(args: SendArgs) =>
          args.method === "Emulation.setCPUThrottlingRate" && args.params?.rate === 1
            ? Promise.reject(new Error("the reset failed too"))
            : cdp.send<T>(args),
      };
    });

    await expect(
      traceSession({
        checkout: checkout(),
        name: "x",
        steps: ["click @e3"],
        throttle: true,
        system,
      }),
    ).rejects.toMatchObject({
      code: "trace_timeout",
      message: expect.not.stringContaining("reset"),
    });
  });

  it("refuses an interaction trace as wrong_viewport at any other window size", async () => {
    const { system, log } = fakeSystem({ viewport: [1280, 577, 2] });

    await expect(
      traceSession({
        checkout: checkout(),
        name: "x",
        steps: ["click @e3"],
        throttle: false,
        system,
      }),
    ).rejects.toMatchObject({
      code: "wrong_viewport",
      message: expect.stringContaining(`agent-browser --session ${SESSION} set viewport 1280 800`),
    });
    expect(log).not.toContain("Tracing.start @page-1");
    expect(log.at(-1)).toBe("close");
  });
});
