// `cw verify trace`: a performance trace of this checkout's agent-browser session (#144), over a CDP
// connection held for the whole trace, so throttling stays on exactly as long as the trace runs. It
// records what the chrome-devtools MCP records, the same way: DevTools' trace categories, and for a
// page load the page, `about:blank`, the trace started, the page loaded, 5 s, the trace stopped.
// A page load is traced in a headless Chrome of its own with the session's cookies, never in
// agent-browser's: agent-browser makes any new tab in its browser its active one. Steps (for INP)
// run in agent-browser's tab, which they need. Throttling is measured, not assumed: Chrome doesn't
// always apply it (the MCP's "4x CPU" traces did the unthrottled amount of work). DevTools' trace
// engine reads the metrics and insights (`trace-summary.ts`). Node runs the CLIs that import this
// directly (type stripping), so relative imports keep their `.ts` extension.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { gzipSync } from "node:zlib";
import { CliError } from "@repo/db/cli/cli-error";
import { type Cdp, type CdpEvent, type SendArgs, connectCdp } from "./cdp.ts";
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
 * events, an agent-browser command. Throttled to 4x CPU and Slow 4G, the app's pages load in 1-2 s.
 */
const STEP_TIMEOUT_MS = 30_000;
/**
 * How many Chromes a page-load trace gets. With CPU throttling and DevTools' categories, Chrome
 * sometimes stalls a load for good: committed, its renderer idle, no load event (Chrome 147: 4 in
 * 10; 156: 2 in 12). That isn't a measurement, so a fresh Chrome tries again.
 */
const ATTEMPTS = 3;
/** The least slowdown that counts as the 4x CPU throttling applied. */
const MIN_CPU_SLOWDOWN = 3;

/** What tracing reaches outside itself for; a test hands in its own. */
export type TraceSystem = {
  /** Runs agent-browser and returns its trimmed output. */
  agentBrowser: (args: string[]) => string;
  connect: (url: string) => Promise<Cdp>;
  /** Starts a headless Chrome with a throwaway profile; `stop` ends it and deletes the profile. */
  launchChrome: () => Promise<LaunchedChrome>;
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

export type LaunchedChrome = { endpoint: string; stop: () => Promise<void> };

/** agent-browser's newest Chrome for Testing, which `agent-browser install` downloads. */
function chromeBinary(): string {
  const browsers = join(homedir(), ".agent-browser/browsers");
  const [newest] = (existsSync(browsers) ? readdirSync(browsers) : [])
    .filter((name) => name.startsWith("chrome-"))
    .toSorted((a, b) => b.localeCompare(a, "en", { numeric: true }));
  const binary =
    newest &&
    join(
      browsers,
      newest,
      "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    );
  if (!binary || !existsSync(binary)) {
    throw new CliError({
      code: "no_chrome",
      message: `No Chrome for Testing in ${browsers}; install it with agent-browser install.`,
    });
  }
  return binary;
}

/**
 * The flags lab tools launch Chrome with (agent-browser's, plus Puppeteer's renderer and timer
 * ones): no background work of Chrome's own competing with the page, and a headless tab never
 * treated as hidden or idle.
 */
const LAB_FLAGS = [
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-networking",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-sync",
  "--disable-hang-monitor",
  "--disable-popup-blocking",
  "--disable-prompt-on-repost",
  "--disable-features=Translate",
  "--metrics-recording-only",
  "--password-store=basic",
  "--use-mock-keychain",
  "--hide-scrollbars",
];

/** A headless Chrome on a port the system picks, once it prints its DevTools endpoint. */
async function launchChrome(): Promise<LaunchedChrome> {
  const profile = mkdtempSync(join(tmpdir(), "cw-trace-chrome-"));
  const child = spawn(
    chromeBinary(),
    ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, ...LAB_FLAGS],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const stop = async () => {
    // A stalled renderer can keep a polite exit waiting: this Chrome is thrown away anyway.
    child.kill("SIGKILL");
    await within({ promise: exited, what: "Stopping the trace's Chrome", ms: STEP_TIMEOUT_MS });
    rmSync(profile, { recursive: true, force: true });
  };
  try {
    const endpoint = await within({
      what: "Starting the trace's Chrome",
      ms: STEP_TIMEOUT_MS,
      promise: new Promise<string>((resolve, reject) => {
        let stderr = "";
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
          const listening = /DevTools listening on (ws:\/\/\S+)/.exec(stderr);
          if (listening?.[1]) resolve(listening[1]);
        });
        child.once("exit", () => reject(new Error(`Chrome exited before listening: ${stderr}`)));
      }),
    });
    return { endpoint, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

export const defaultTraceSystem: TraceSystem = {
  agentBrowser,
  connect: connectCdp,
  launchChrome,
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

/** The browser's own Web Performance API readings of a page load, beside the trace's. */
export type BrowserApiReading = { lcpMs: number | null; cls: number };

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
  /** With throttling, how much slower the page did a fixed piece of work: about 4. */
  cpuSlowdown?: number;
  /** How many Chromes the trace took: more than 1 when Chrome stalled a load. */
  attempts: number;
};

const timedOut = ({ what, ms }: { what: string; ms: number }) =>
  new CliError({
    code: "trace_timeout",
    message: `${what} took over ${ms / 1000} s, so the trace was abandoned.`,
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
    send: <T>(args: SendArgs) =>
      within({ promise: cdp.send<T>(args), what: `Chrome's answer to ${args.method}`, ms }),
  };
}

type NextEventArgs = {
  cdp: Cdp;
  match: (event: CdpEvent) => boolean;
  /** What's awaited, for the refusal's message. */
  what: string;
  ms: number;
};

/** Resolves on the first event `match` accepts, or refuses as `trace_timeout` after `ms`. */
function nextEvent({ cdp, match, what, ms }: NextEventArgs): Promise<CdpEvent> {
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

/** A fixed piece of CPU work, timed in the page: it takes about 4x as long under 4x throttling. */
const TIMED_WORK =
  "(() => { const start = performance.now(); let sum = 0; " +
  "for (let i = 0; i < 2e7; i++) sum += i % 7; return performance.now() - start; })()";

/** How long the page takes for the timed work, the faster of two runs, so its JIT has settled. */
async function workTime({ cdp, sessionId }: Tab): Promise<number> {
  const run = async () =>
    (
      await cdp.send<{ result: { value: number } }>({
        method: "Runtime.evaluate",
        params: { expression: TIMED_WORK, returnByValue: true },
        sessionId,
      })
    ).result.value;
  const first = await run();
  return Math.min(first, await run());
}

/** The slowdown the throttling caused, refused as `throttle_not_applied` when there was none. */
function checkSlowdown({ before, after }: { before: number; after: number }): number {
  const slowdown = Math.round((after / before) * 10) / 10;
  if (slowdown < MIN_CPU_SLOWDOWN) {
    throw new CliError({
      code: "throttle_not_applied",
      message:
        `Chrome was asked for 4× CPU throttling, but the page did the same work only ${slowdown}× ` +
        `slower (${Math.round(before)} ms, then ${Math.round(after)} ms), so the numbers would be ` +
        "unthrottled ones. Trace again.",
    });
  }
  return slowdown;
}

/** Splits an agent-browser command into its arguments, keeping "quoted text" as one. */
export function argumentsOf(step: string): string[] {
  return [...step.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(
    ([, double, single, bare]) => double ?? single ?? bare ?? "",
  );
}

/** How long an interaction's event timing gets to reach the trace after the last step. */
const INTERACTION_SETTLE_MS = 1000;

/**
 * Runs `work`, then `cleanUp` however it ended. When `work` failed, its error is the one thrown,
 * even if `cleanUp` fails too: a cleanup step timing out after a load did would otherwise hide why.
 */
async function thenCleanUp<T>({
  work,
  cleanUp,
}: {
  work: () => Promise<T>;
  cleanUp: () => Promise<void>;
}): Promise<T> {
  let result: T;
  try {
    result = await work();
  } catch (error) {
    await cleanUp().catch(() => {});
    throw error;
  }
  await cleanUp();
  return result;
}

type RecordArgs = Tab & { during: () => Promise<void>; ms: number };

/** Records a trace of the tab while `during` runs, and returns its events. */
async function record({ cdp, sessionId, during, ms }: RecordArgs): Promise<unknown[]> {
  const collected: unknown[] = [];
  const off = cdp.on((event) => {
    const { value } = event.params;
    if (event.method === "Tracing.dataCollected" && Array.isArray(value)) collected.push(...value);
  });
  try {
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
    return collected;
  } finally {
    off();
  }
}

type Page = { targetId: string; browserContextId: string; sessionId: string };

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

/** A cookie as `Storage.getCookies` gives it, which `Storage.setCookies` takes back. */
type Cookie = Record<string, unknown> & { session?: boolean; expires?: number; size?: number };

/** A session cookie keeps no `expires`: -1 there would set it already expired. */
function toCookieParam({ session, expires, size: _size, ...cookie }: Cookie) {
  return session ? cookie : { ...cookie, expires };
}

type TraceLoadArgs = {
  cookies: Cookie[];
  url: string;
  deviceScaleFactor: number;
  throttle: boolean;
  system: TraceSystem;
};

type TracedLoad = { events: unknown[]; browserApi: BrowserApiReading; cpuSlowdown?: number };

/**
 * A page load of `url` in a headless Chrome of its own, signed in with the session's cookies, at
 * the trace window size and the session's pixel ratio, then thrown away (so throttling is never
 * turned off in it). Its tab starts where the MCP's does, on the page, then follows its sequence:
 * about:blank, the trace started, the page loaded, 5 s, the trace stopped.
 */
async function traceLoad({
  cookies,
  url,
  deviceScaleFactor,
  throttle,
  system,
}: TraceLoadArgs): Promise<TracedLoad> {
  const chrome = await system.launchChrome();
  let connected: Cdp | undefined;
  return thenCleanUp({
    cleanUp: async () => {
      connected?.close();
      await chrome.stop();
    },
    work: async () => {
      const cdp = withDeadlines({
        cdp: await system.connect(chrome.endpoint),
        ms: system.stepTimeoutMs,
      });
      connected = cdp;
      await cdp.send({
        method: "Storage.setCookies",
        params: { cookies: cookies.map(toCookieParam) },
      });
      const { targetId } = await cdp.send<{ targetId: string }>({
        method: "Target.createTarget",
        params: { url: "about:blank" },
      });
      const { sessionId } = await cdp.send<{ sessionId: string }>({
        method: "Target.attachToTarget",
        params: { targetId, flatten: true },
      });
      await cdp.send({
        method: "Emulation.setDeviceMetricsOverride",
        params: { ...TRACE_VIEWPORT, deviceScaleFactor, mobile: false },
        sessionId,
      });
      await cdp.send({ method: "Page.enable", sessionId });
      await cdp.send({ method: "Page.bringToFront", sessionId });
      const { result } = await cdp.send<{ result: { value: string } }>({
        method: "Runtime.evaluate",
        params: { expression: "document.visibilityState", returnByValue: true },
        sessionId,
      });
      if (result.value !== "visible") {
        throw new CliError({
          code: "hidden_tab",
          message: `The trace's tab is ${result.value}, and Chrome records no LCP for a hidden page.`,
        });
      }
      const load = async (to: string) => {
        const loaded = nextEvent({
          cdp,
          match: (event) => event.method === "Page.loadEventFired" && event.sessionId === sessionId,
          what: `Loading ${to}`,
          ms: system.stepTimeoutMs,
        });
        await Promise.all([
          cdp.send({ method: "Page.navigate", params: { url: to }, sessionId }),
          loaded,
        ]);
      };
      await load(url);
      const before = throttle ? await workTime({ cdp, sessionId }) : 0;
      await load("about:blank");
      if (throttle) await setThrottling({ cdp, sessionId, on: true });
      const events = await record({
        cdp,
        sessionId,
        ms: system.stepTimeoutMs,
        async during() {
          await load(url);
          await system.sleep(SETTLE_MS);
        },
      });
      const cpuSlowdown = throttle
        ? checkSlowdown({ before, after: await workTime({ cdp, sessionId }) })
        : undefined;
      const reading = await cdp.send<{ result: { value: BrowserApiReading } }>({
        method: "Runtime.evaluate",
        params: { expression: BROWSER_API_READING, awaitPromise: true, returnByValue: true },
        sessionId,
      });
      return { events, browserApi: reading.result.value, ...(cpuSlowdown && { cpuSlowdown }) };
    },
  });
}

/** `traceLoad`, in a fresh Chrome each time Chrome stalls the load, up to `ATTEMPTS` Chromes. */
async function traceLoadRetrying(args: TraceLoadArgs): Promise<TracedLoad & { attempts: number }> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- one Chrome at a time, until one doesn't stall
      return { ...(await traceLoad(args)), attempts: attempt };
    } catch (error) {
      if (!(error instanceof CliError) || error.code !== "trace_timeout") throw error;
      if (attempt === ATTEMPTS) {
        throw new CliError({
          code: "trace_timeout",
          message: `${error.message} Chrome stalled the load in ${ATTEMPTS} tries, each in a fresh Chrome.`,
        });
      }
    }
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

/**
 * `steps` run by agent-browser in its own tab while recording, without reloading it; throttled
 * throughout when asked, and turned back off however it ends, since the tab stays in use.
 */
async function traceSteps({
  cdp,
  page,
  viewport,
  steps,
  session,
  throttle,
  system,
}: TraceStepsArgs): Promise<{ events: unknown[]; cpuSlowdown?: number }> {
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
  const tab = { cdp, sessionId: page.sessionId };
  const before = throttle ? await workTime(tab) : 0;
  if (throttle) await setThrottling({ ...tab, on: true });
  return thenCleanUp({
    cleanUp: async () => {
      if (throttle) await setThrottling({ ...tab, on: false });
    },
    work: async () => {
      const events = await record({
        ...tab,
        ms: system.stepTimeoutMs,
        async during() {
          for (const step of steps) {
            system.agentBrowser(["--session", session, ...argumentsOf(step)]);
          }
          await system.sleep(INTERACTION_SETTLE_MS);
        },
      });
      if (!throttle) return { events };
      return { events, cpuSlowdown: checkSlowdown({ before, after: await workTime(tab) }) };
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
  let traced: { events: unknown[]; browserApi?: BrowserApiReading; cpuSlowdown?: number } = {
    events: [],
  };
  let viewport: { width: number; height: number } = TRACE_VIEWPORT;
  let cookies: Cookie[] = [];
  let deviceScaleFactor = 1;
  let attempts = 1;
  try {
    const { targetInfos } = await cdp.send<{
      targetInfos: Array<{ targetId: string; type: string; url: string; browserContextId: string }>;
    }>({ method: "Target.getTargets" });
    const target = targetInfos.find(({ type, url: at }) => type === "page" && at === url);
    if (!target) {
      throw new CliError({
        code: "no_page",
        message: `The session ${session}'s browser has no page at ${url}; open it with agent-browser first.`,
      });
    }
    const { sessionId } = await cdp.send<{ sessionId: string }>({
      method: "Target.attachToTarget",
      params: { targetId: target.targetId, flatten: true },
    });
    const page = {
      targetId: target.targetId,
      browserContextId: target.browserContextId,
      sessionId,
    };
    const { result } = await cdp.send<{ result: { value: [number, number, number] } }>({
      method: "Runtime.evaluate",
      params: { expression: "[innerWidth, innerHeight, devicePixelRatio]", returnByValue: true },
      sessionId,
    });
    const [width, height, ratio] = result.value;
    deviceScaleFactor = ratio;
    if (mode === "load") {
      // Chrome names only the contexts created in it: the default one, where agent-browser's own
      // Chrome keeps its tab, is read by giving no id.
      const { browserContextIds } = await cdp.send<{ browserContextIds: string[] }>({
        method: "Target.getBrowserContexts",
      });
      ({ cookies } = await cdp.send<{ cookies: Cookie[] }>({
        method: "Storage.getCookies",
        params: browserContextIds.includes(page.browserContextId)
          ? { browserContextId: page.browserContextId }
          : {},
      }));
    } else {
      viewport = { width, height };
      traced = await traceSteps({ cdp, page, viewport, steps, session, throttle, system });
    }
  } finally {
    cdp.close();
  }
  if (mode === "load") {
    const loaded = await traceLoadRetrying({ cookies, url, deviceScaleFactor, throttle, system });
    ({ attempts } = loaded);
    traced = loaded;
  }

  const { events, browserApi, cpuSlowdown } = traced;
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
    ...(cpuSlowdown && { cpuSlowdown }),
    attempts,
  };
}
