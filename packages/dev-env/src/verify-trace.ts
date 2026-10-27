// `cw verify trace`: a performance trace of this checkout's agent-browser session, in the session's
// own Chrome (`cw verify browser start`), over a CDP connection held for the whole trace, so
// throttling stays on exactly as long as the trace runs. It records what the chrome-devtools MCP
// records, the same way (#144): DevTools' trace categories, and for a page load `about:blank`, the
// trace started, the page loaded, 5 s, the trace stopped, in a tab of its own. DevTools' trace engine reads the
// metrics and insights from it (`trace-summary.ts`). Node runs the CLIs that import this directly
// (type stripping), so relative imports keep their `.ts` extension.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { gzipSync } from "node:zlib";
import { CliError } from "@repo/db/cli/cli-error";
import { type Cdp, type CdpEvent, connectCdp } from "./cdp.ts";
import type { Checkout } from "./checkout.ts";
import { verifyResources } from "./names.ts";
import type { TraceMode, TraceSummary, summarizeTrace } from "./trace-summary.ts";

/**
 * DevTools' trace categories, as the chrome-devtools MCP passes them: the Performance panel's
 * defaults plus the JS sampling and screenshots its UI turns on. agent-browser's own `profiler`
 * defaults leave out layout shifts, so CLS would read 0.
 */
export const TRACE_CATEGORIES = [
  "blink.console",
  "blink.user_timing",
  "loading",
  "devtools.timeline",
  "disabled-by-default-devtools.target-rundown",
  "disabled-by-default-devtools.timeline.frame",
  "disabled-by-default-devtools.timeline.stack",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.v8-source-rundown-sources",
  "disabled-by-default-devtools.v8-source-rundown",
  "disabled-by-default-layout_shift.debug",
  "disabled-by-default-v8.inspector",
  "disabled-by-default-v8.cpu_profiler.hires",
  "disabled-by-default-lighthouse",
  "v8.execute",
  "v8",
  "cppgc",
  "navigation,rail",
  "disabled-by-default-v8.cpu_profiler",
  "disabled-by-default-devtools.screenshot",
];

/** The window every trace is taken at: CLS is a share of the viewport, so it moves with the size. */
export const TRACE_VIEWPORT = { width: 1280, height: 800 };

/** How long the MCP keeps recording after a page's load event, for late shifts and paints. */
const SETTLE_MS = 5000;
/**
 * How long any one step gets: a Chrome command's answer, a page's load event, the trace's last
 * events, an agent-browser command. Throttled to Slow 4G, the app's pages load in about 1 s.
 */
const STEP_TIMEOUT_MS = 60_000;

/** What tracing reaches outside itself for; a test hands in its own. */
export type TraceSystem = {
  /** Runs agent-browser and returns its trimmed output. */
  agentBrowser: (args: string[]) => string;
  connect: (url: string) => Promise<Cdp>;
  summarize: typeof summarizeTrace;
  sleep: (ms: number) => Promise<void>;
  /** How long any one step may take before the trace is refused as `trace_timeout`. */
  stepTimeoutMs: number;
};

function agentBrowser(args: string[]): string {
  try {
    return execFileSync("agent-browser", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: STEP_TIMEOUT_MS,
    }).trim();
  } catch (error) {
    const stderr =
      error instanceof Error && "stderr" in error && typeof error.stderr === "string"
        ? error.stderr.trim()
        : "";
    throw new CliError({
      code: "agent_browser_failed",
      message: `agent-browser ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`,
    });
  }
}

export const defaultTraceSystem: TraceSystem = {
  agentBrowser,
  connect: connectCdp,
  summarize: async (args) => (await import("./trace-summary.ts")).summarizeTrace(args),
  sleep: (ms) => sleep(ms),
  stepTimeoutMs: STEP_TIMEOUT_MS,
};

export type TraceSessionArgs = {
  checkout: Checkout;
  /** The trace's name: it's saved as `.dev/perf/<name>.trace.json.gz` in this checkout. */
  name: string;
  /**
   * agent-browser commands (without `--session`) to run while recording, for INP; none traces a
   * page load of the session's current page instead.
   */
  steps: string[];
  /** 4× CPU and Slow 4G, the throttling DevTools offers, for the whole trace. */
  throttle: boolean;
  /** The agent-browser session; this checkout's own by default. */
  session?: string | undefined;
  system?: TraceSystem | undefined;
};

export type TracedSession = {
  session: string;
  /** The page traced. */
  url: string;
  mode: TraceMode;
  throttled: boolean;
  viewport: { width: number; height: number };
  /** The saved trace, which DevTools' Performance panel opens. */
  file: string;
  summary: TraceSummary;
  /** A page load's browser API readings, which should match `summary.lcp` and `summary.cls`. */
  browserApi?: BrowserApiReading;
};

const timedOut = ({ what, ms }: { what: string; ms: number }) =>
  new CliError({
    code: "trace_timeout",
    message: `${what} took over ${ms / 1000} s, so the trace was abandoned and its tab closed.`,
  });

/** `promise`, or a `trace_timeout` refusal naming `what` once `ms` pass. */
function within<T>({ promise, what, ms }: { promise: Promise<T>; what: string; ms: number }) {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(timedOut({ what, ms })), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** `cdp` with every command refused as `trace_timeout` once Chrome takes over `ms` to answer. */
function withDeadlines({ cdp, ms }: { cdp: Cdp; ms: number }): Cdp {
  return {
    ...cdp,
    send: (args) => within({ promise: cdp.send(args), what: `Chrome's answer to ${args.method}`, ms }),
  };
}

/** Resolves on the first event `match` accepts, or refuses as `trace_timeout` after `ms`. */
function nextEvent({
  cdp,
  match,
  what,
  ms,
}: {
  cdp: Cdp;
  match: (event: CdpEvent) => boolean;
  what: string;
  ms: number;
}): Promise<CdpEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(timedOut({ what, ms }));
    }, ms);
    const off = cdp.on((event) => {
      if (!match(event)) return;
      clearTimeout(timer);
      off();
      resolve(event);
    });
  });
}

/** DevTools' "Slow 4G" preset (bytes per second, ms), which the MCP's `emulate` applies too. */
const SLOW_4G = { latency: 562.5, downloadThroughput: 180_000, uploadThroughput: 84_375 };
const NO_THROTTLING = { latency: 0, downloadThroughput: -1, uploadThroughput: -1 };

type Tab = { cdp: Cdp; sessionId: string };

async function setThrottling({ cdp, sessionId, on }: Tab & { on: boolean }) {
  await cdp.send({
    method: "Emulation.setCPUThrottlingRate",
    params: { rate: on ? 4 : 1 },
    sessionId,
  });
  if (on) await cdp.send({ method: "Network.enable", sessionId });
  await cdp.send({
    method: "Network.emulateNetworkConditions",
    params: { offline: false, ...(on ? SLOW_4G : NO_THROTTLING) },
    sessionId,
  });
}

/** Splits an agent-browser command into its arguments, keeping "quoted text" as one. */
export function argumentsOf(step: string): string[] {
  return [...step.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(
    ([, double, single, bare]) => double ?? single ?? bare ?? "",
  );
}

/** How long an interaction's event timing gets to reach the trace after the last step. */
const INTERACTION_SETTLE_MS = 1000;

type RecordArgs = Tab & { throttle: boolean; during: () => Promise<void>; ms: number };

/**
 * Records a trace of the tab while `during` runs, throttled throughout when asked and turned back
 * off however it ends, and returns its events.
 */
async function record({ cdp, sessionId, throttle, during, ms }: RecordArgs): Promise<unknown[]> {
  if (throttle) await setThrottling({ cdp, sessionId, on: true });
  try {
    const collected: unknown[] = [];
    const off = cdp.on((event) => {
      if (event.method === "Tracing.dataCollected") {
        collected.push(...(event.params.value as unknown[]));
      }
    });
    await cdp.send({
      method: "Tracing.start",
      params: {
        traceConfig: { includedCategories: TRACE_CATEGORIES, excludedCategories: ["*"] },
        transferMode: "ReportEvents",
      },
      sessionId,
    });
    await during();
    const complete = nextEvent({
      cdp,
      match: (event) => event.method === "Tracing.tracingComplete",
      what: "The trace's last events",
      ms,
    });
    await Promise.all([cdp.send({ method: "Tracing.end", sessionId }), complete]);
    off();
    return collected;
  } finally {
    if (throttle) await setThrottling({ cdp, sessionId, on: false });
  }
}

type Page = { targetId: string; browserContextId: string; sessionId: string };

/** The browser's own Web Performance API readings of a page load, beside the trace's. */
export type BrowserApiReading = { lcpMs: number | null; cls: number };

/**
 * Reads the loaded page's buffered `largest-contentful-paint` and `layout-shift` entries: the
 * browser's own LCP (its last candidate; rounded, often to 4 ms) and CLS (shifts without recent
 * input, summed), measured apart from the trace, so a trace engine misreading shows as a mismatch.
 */
const BROWSER_API_READING = `new Promise((resolve) => {
  const reading = { lcpMs: null, cls: 0 };
  new PerformanceObserver((list) => {
    const last = list.getEntries().at(-1);
    if (last) reading.lcpMs = last.startTime;
  }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((list) => {
    for (const shift of list.getEntries()) if (!shift.hadRecentInput) reading.cls += shift.value;
  }).observe({ type: "layout-shift", buffered: true });
  setTimeout(() => resolve(reading), 200);
})`;

type TraceLoadArgs = {
  cdp: Cdp;
  page: Page;
  url: string;
  deviceScaleFactor: number;
  throttle: boolean;
  system: TraceSystem;
};

/**
 * A page load of `url` in a tab of its own, in the session's browser context (its cookies, so
 * signed in), at the trace window size, then closed. agent-browser's tab is never navigated: a
 * navigation it didn't make leaves it waiting on a tab it thinks is stuck, until it swaps in a blank
 * one. The tab opens on about:blank, so this is the MCP's sequence: about:blank, the trace started,
 * the page loaded, 5 s, the trace stopped.
 */
async function traceLoad({ cdp, page, url, deviceScaleFactor, throttle, system }: TraceLoadArgs) {
  const { targetId } = (await cdp.send({
    method: "Target.createTarget",
    params: { url: "about:blank", browserContextId: page.browserContextId },
  })) as { targetId: string };
  try {
    const { sessionId } = (await cdp.send({
      method: "Target.attachToTarget",
      params: { targetId, flatten: true },
    })) as { sessionId: string };
    await cdp.send({
      method: "Emulation.setDeviceMetricsOverride",
      params: { ...TRACE_VIEWPORT, deviceScaleFactor, mobile: false },
      sessionId,
    });
    await cdp.send({ method: "Page.enable", sessionId });
    await cdp.send({ method: "Page.bringToFront", sessionId });
    const { result } = (await cdp.send({
      method: "Runtime.evaluate",
      params: { expression: "document.visibilityState", returnByValue: true },
      sessionId,
    })) as { result: { value: string } };
    if (result.value !== "visible") {
      throw new CliError({
        code: "hidden_tab",
        message: `The trace's tab is ${result.value}, and Chrome records no LCP for a hidden page.`,
      });
    }
    const events = await record({
      cdp,
      sessionId,
      throttle,
      ms: system.stepTimeoutMs,
      async during() {
        const loaded = nextEvent({
          cdp,
          match: (event) => event.method === "Page.loadEventFired" && event.sessionId === sessionId,
          what: `Loading ${url}`,
          ms: system.stepTimeoutMs,
        });
        await Promise.all([cdp.send({ method: "Page.navigate", params: { url }, sessionId }), loaded]);
        await system.sleep(SETTLE_MS);
      },
    });
    const reading = (await cdp.send({
      method: "Runtime.evaluate",
      params: { expression: BROWSER_API_READING, awaitPromise: true, returnByValue: true },
      sessionId,
    })) as { result: { value: BrowserApiReading } };
    return { events, browserApi: reading.result.value };
  } finally {
    await cdp.send({ method: "Target.closeTarget", params: { targetId } });
    await cdp.send({ method: "Page.bringToFront", sessionId: page.sessionId });
  }
}

type TraceStepsArgs = {
  cdp: Cdp;
  page: Page;
  viewport: { width: number; height: number };
  steps: string[];
  session: string;
  throttle: boolean;
  system: TraceSystem;
};

/** `steps` run by agent-browser in its own tab while recording, without reloading it. */
async function traceSteps({ cdp, page, viewport, steps, session, throttle, system }: TraceStepsArgs) {
  if (viewport.width !== TRACE_VIEWPORT.width || viewport.height !== TRACE_VIEWPORT.height) {
    const { width, height } = TRACE_VIEWPORT;
    throw new CliError({
      code: "wrong_viewport",
      message:
        `The page is ${viewport.width}×${viewport.height}; traces are taken at ${width}×${height}, ` +
        `since CLS changes with the window. Run agent-browser --session ${session} set viewport ` +
        `${width} ${height}, then trace again.`,
    });
  }
  return record({
    cdp,
    sessionId: page.sessionId,
    throttle,
    ms: system.stepTimeoutMs,
    async during() {
      for (const step of steps) system.agentBrowser(["--session", session, ...argumentsOf(step)]);
      await system.sleep(INTERACTION_SETTLE_MS);
    },
  });
}

export async function traceSession({
  checkout,
  name,
  steps,
  throttle,
  session: chosen,
  system = defaultTraceSystem,
}: TraceSessionArgs): Promise<TracedSession> {
  const session = chosen ?? verifyResources(checkout.worktreeId).session;
  const url = system.agentBrowser(["--session", session, "get", "url"]);
  const endpoint = system.agentBrowser(["--session", session, "get", "cdp-url"]);
  const cdp = withDeadlines({ cdp: await system.connect(endpoint), ms: system.stepTimeoutMs });
  const mode: TraceMode = steps.length > 0 ? "interaction" : "load";
  let events: unknown[];
  let viewport: { width: number; height: number };
  let browserApi: BrowserApiReading | undefined;
  try {
    const { targetInfos } = (await cdp.send({ method: "Target.getTargets" })) as {
      targetInfos: Array<{ targetId: string; type: string; url: string; browserContextId: string }>;
    };
    const target = targetInfos.find(({ type, url: at }) => type === "page" && at === url);
    if (!target) {
      throw new CliError({
        code: "no_page",
        message: `The session ${session}'s browser has no page at ${url}; open it with agent-browser first.`,
      });
    }
    const { sessionId } = (await cdp.send({
      method: "Target.attachToTarget",
      params: { targetId: target.targetId, flatten: true },
    })) as { sessionId: string };
    const page = { targetId: target.targetId, browserContextId: target.browserContextId, sessionId };
    const { result } = (await cdp.send({
      method: "Runtime.evaluate",
      params: { expression: "[innerWidth, innerHeight, devicePixelRatio]", returnByValue: true },
      sessionId,
    })) as { result: { value: [number, number, number] } };
    const [width, height, deviceScaleFactor] = result.value;
    if (mode === "load") {
      viewport = TRACE_VIEWPORT;
      ({ events, browserApi } = await traceLoad({
        cdp,
        page,
        url,
        deviceScaleFactor,
        throttle,
        system,
      }));
    } else {
      viewport = { width, height };
      events = await traceSteps({ cdp, page, viewport, steps, session, throttle, system });
    }
  } finally {
    cdp.close();
  }

  const file = join(checkout.top, ".dev/perf", `${name}.trace.json.gz`);
  mkdirSync(join(checkout.top, ".dev/perf"), { recursive: true });
  writeFileSync(file, gzipSync(JSON.stringify({ traceEvents: events })));
  const summary = await system.summarize({ events, mode });
  return {
    session,
    url,
    mode,
    throttled: throttle,
    viewport,
    file,
    summary,
    ...(browserApi && { browserApi }),
  };
}
