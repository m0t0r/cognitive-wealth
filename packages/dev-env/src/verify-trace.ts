// `cw verify trace`: a performance trace of this checkout's agent-browser session, in the session's
// own Chrome (`cw verify browser start`), over a CDP connection held for the whole trace, so
// throttling stays on exactly as long as the trace runs. It records what the chrome-devtools MCP
// records, the same way (#144): DevTools' trace categories, and for a page load `about:blank`, the
// trace started, the page loaded again, 5 s, the trace stopped. DevTools' trace engine reads the
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
/** How long a page gets to fire its load event. */
const LOAD_TIMEOUT_MS = 30_000;

/** What tracing reaches outside itself for; a test hands in its own. */
export type TraceSystem = {
  /** Runs agent-browser and returns its trimmed output. */
  agentBrowser: (args: string[]) => string;
  connect: (url: string) => Promise<Cdp>;
  summarize: typeof summarizeTrace;
  sleep: (ms: number) => Promise<void>;
};

function agentBrowser(args: string[]): string {
  try {
    return execFileSync("agent-browser", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
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
};

/** Resolves on the first event `match` accepts, or rejects after `ms`. */
function nextEvent({
  cdp,
  match,
  ms,
}: {
  cdp: Cdp;
  match: (event: CdpEvent) => boolean;
  ms: number;
}): Promise<CdpEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new CliError({ code: "load_timeout", message: `No load event within ${ms / 1000} s.` }));
    }, ms);
    const off = cdp.on((event) => {
      if (!match(event)) return;
      clearTimeout(timer);
      off();
      resolve(event);
    });
  });
}

/** Navigates the page and waits for its load event. */
async function load({ cdp, sessionId, url }: { cdp: Cdp; sessionId: string; url: string }) {
  const loaded = nextEvent({
    cdp,
    match: (event) => event.method === "Page.loadEventFired" && event.sessionId === sessionId,
    ms: LOAD_TIMEOUT_MS,
  });
  await cdp.send({ method: "Page.navigate", params: { url }, sessionId });
  await loaded;
}

/** DevTools' "Slow 4G" preset (bytes per second, ms), which the MCP's `emulate` applies too. */
const SLOW_4G = { latency: 562.5, downloadThroughput: 180_000, uploadThroughput: 84_375 };
const NO_THROTTLING = { latency: 0, downloadThroughput: -1, uploadThroughput: -1 };

async function setThrottling({ cdp, sessionId, on }: { cdp: Cdp; sessionId: string; on: boolean }) {
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

type RecordArgs = {
  cdp: Cdp;
  sessionId: string;
  url: string;
  steps: string[];
  session: string;
  system: TraceSystem;
};

/** Records a page load of `url`, or `steps` run on the current page, and returns the events. */
async function record({ cdp, sessionId, url, steps, session, system }: RecordArgs) {
  if (steps.length === 0) {
    await cdp.send({ method: "Page.enable", sessionId });
    await load({ cdp, sessionId, url: "about:blank" });
  }
  const collected: unknown[] = [];
  const complete = new Promise<void>((resolve) => {
    const off = cdp.on((event) => {
      if (event.method === "Tracing.dataCollected") {
        collected.push(...(event.params.value as unknown[]));
      } else if (event.method === "Tracing.tracingComplete") {
        off();
        resolve();
      }
    });
  });
  await cdp.send({
    method: "Tracing.start",
    params: {
      traceConfig: { includedCategories: TRACE_CATEGORIES, excludedCategories: ["*"] },
      transferMode: "ReportEvents",
    },
    sessionId,
  });
  if (steps.length === 0) {
    await load({ cdp, sessionId, url });
    await system.sleep(SETTLE_MS);
  } else {
    for (const step of steps) system.agentBrowser(["--session", session, ...argumentsOf(step)]);
    await system.sleep(INTERACTION_SETTLE_MS);
  }
  await cdp.send({ method: "Tracing.end", sessionId });
  await complete;
  return collected;
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
  const cdp = await system.connect(endpoint);
  let events: unknown[] = [];
  let viewport: { width: number; height: number };
  const mode: TraceMode = steps.length > 0 ? "interaction" : "load";
  try {
    const { targetInfos } = (await cdp.send({ method: "Target.getTargets" })) as {
      targetInfos: Array<{ targetId: string; type: string; url: string }>;
    };
    const page = targetInfos.find((target) => target.type === "page" && target.url === url);
    if (!page) {
      throw new CliError({
        code: "no_page",
        message: `The session ${session}'s browser has no page at ${url}; open it with agent-browser first.`,
      });
    }
    const { sessionId } = (await cdp.send({
      method: "Target.attachToTarget",
      params: { targetId: page.targetId, flatten: true },
    })) as { sessionId: string };
    const { result } = (await cdp.send({
      method: "Runtime.evaluate",
      params: { expression: "[innerWidth, innerHeight]", returnByValue: true },
      sessionId,
    })) as { result: { value: [number, number] } };
    viewport = { width: result.value[0], height: result.value[1] };
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

    if (throttle) await setThrottling({ cdp, sessionId, on: true });
    try {
      events = await record({ cdp, sessionId, url, steps, session, system });
    } finally {
      if (throttle) await setThrottling({ cdp, sessionId, on: false });
    }
  } finally {
    cdp.close();
  }

  const file = join(checkout.top, ".dev/perf", `${name}.trace.json.gz`);
  mkdirSync(join(checkout.top, ".dev/perf"), { recursive: true });
  writeFileSync(file, gzipSync(JSON.stringify({ traceEvents: events })));
  const summary = await system.summarize({ events, mode });
  return { session, url, mode, throttled: throttle, viewport, file, summary };
}
