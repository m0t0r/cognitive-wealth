// What a performance trace measured, read by DevTools' own trace engine (the Performance panel's,
// published as `@paulirish/trace_engine`, the same code the chrome-devtools MCP bundles), through
// the helpers its summary uses (`getLCP`, `getCLS`, `getINP`). The engine reports CLS 0 for a trace
// that never recorded layout shifts and has no INP without an interaction, so a trace missing what a
// number needs is refused, never summarized (#144). The engine's API isn't stable, so it's pinned
// exactly and `trace-summary.test.ts` reads saved traces with known answers. Node runs the CLIs
// that import this directly (type stripping), so relative imports keep their `.ts` extension.
import { CliError } from "@repo/db/cli/cli-error";

/** `load`: a page load (LCP, CLS); `interaction`: steps driven while recording (INP). */
export type TraceMode = "load" | "interaction";

export type TraceInsight = {
  /** The insight's key, as DevTools names it (`LCPBreakdown`, `RenderBlocking`, …). */
  name: string;
  title: string;
  /** `fail`: something to fix; `informative`: worth reading; `pass`: nothing found. */
  state: "pass" | "fail" | "informative";
  /** What it says, for an insight that didn't pass. */
  description?: string;
  /** Estimated savings: ms for LCP and INP, a score for CLS. */
  savings?: { LCP?: number; INP?: number; CLS?: number };
};

export type TraceSummary = {
  /** The page the numbers are for. */
  url: string;
  /** A page load's Largest Contentful Paint, with its subparts in ms. */
  lcp?: { ms: number; subparts: Record<string, number> };
  /** A page load's Cumulative Layout Shift, its worst session window. */
  cls?: number;
  /** An interaction trace's Interaction to Next Paint: its longest interaction. */
  inp?: { ms: number; type: string };
  insights: TraceInsight[];
};

type TraceEvent = { name?: string; cat?: string };

/** The engine reads layout shift rectangles into `DOMRect`s, which Node lacks. */
function polyfillDOMRect() {
  if ("DOMRect" in globalThis) return;
  class DOMRect {
    x: number;
    y: number;
    width: number;
    height: number;
    constructor(x = 0, y = 0, width = 0, height = 0) {
      this.x = x;
      this.y = y;
      this.width = width;
      this.height = height;
    }
    get top() {
      return Math.min(this.y, this.y + this.height);
    }
    get right() {
      return Math.max(this.x, this.x + this.width);
    }
    get bottom() {
      return Math.max(this.y, this.y + this.height);
    }
    get left() {
      return Math.min(this.x, this.x + this.width);
    }
  }
  Object.assign(globalThis, { DOMRect });
}

const refuse = ({ code, message }: { code: string; message: string }) =>
  new CliError({ code, message });

const toMs = (micro: number) => Math.round(micro) / 1000;

/**
 * An insight's English text. The engine leaves its strings unlocalized in Node, as the English
 * template (`i18nId`) and its `{placeholder}` values.
 */
function textOf(localized: unknown): string {
  if (typeof localized === "string") return localized;
  if (typeof localized !== "object" || localized === null || !("i18nId" in localized)) {
    return String(localized);
  }
  const { i18nId, values } = localized as { i18nId: string; values?: Record<string, unknown> };
  return i18nId.replaceAll(/\{(\w+)\}/g, (whole, key: string) =>
    values && key in values ? String(values[key]) : whole,
  );
}

const NO_INTERACTION = {
  code: "no_interaction",
  message:
    "The steps produced no interaction Chrome times (a click, tap or key press), so there's no INP.",
};

export async function summarizeTrace({
  events,
  mode,
}: {
  events: unknown[];
  mode: TraceMode;
}): Promise<TraceSummary> {
  if (events.length === 0) {
    throw refuse({ code: "unreadable_trace", message: "The trace holds no events." });
  }
  // Layout shifts and LCP candidates are both `loading` events: without any, the categories that
  // record them were off, and CLS would read 0.
  if (!events.some((event) => (event as TraceEvent).cat?.split(",").includes("loading"))) {
    throw refuse({
      code: "incomplete_trace",
      message: "The trace recorded no `loading` events (layout shifts, LCP): its categories were wrong.",
    });
  }
  if (mode === "interaction" && !events.some((event) => (event as TraceEvent).name === "EventTiming")) {
    throw refuse(NO_INTERACTION);
  }
  polyfillDOMRect();
  const Trace = await import("@paulirish/trace_engine");
  const model = Trace.TraceModel.Model.createWithAllHandlers();
  let insightSets: NonNullable<ReturnType<typeof model.parsedTrace>>["insights"];
  try {
    await model.parse(events as Parameters<typeof model.parse>[0]);
    insightSets = model.parsedTrace()?.insights ?? null;
  } catch (error) {
    throw refuse({
      code: "unreadable_trace",
      message: `DevTools' trace engine couldn't read the trace: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  if (!insightSets || insightSets.size === 0) {
    throw refuse({ code: "unreadable_trace", message: "DevTools' trace engine found no page in the trace." });
  }
  const { Common } = Trace.Insights;
  const sets = [...insightSets.values()];

  // A page load: the last navigation to a real page, never the about:blank the trace starts from.
  // An interaction: the set that holds it.
  const set =
    mode === "load"
      ? sets.findLast((candidate) => candidate.navigation && candidate.url.protocol !== "about:")
      : sets.find((candidate) => Common.getINP(candidate));
  if (!set) {
    throw mode === "load"
      ? refuse({
          code: "no_navigation",
          message: "The trace holds no load of the page, so it has no LCP or CLS.",
        })
      : refuse(NO_INTERACTION);
  }

  const insights = Object.entries(set.model).flatMap(([name, insight]): TraceInsight[] => {
    if (insight instanceof Error) return [];
    const { title, state, description, metricSavings } = insight;
    const savings = metricSavings && {
      ...(metricSavings.LCP !== undefined && { LCP: metricSavings.LCP }),
      ...(metricSavings.INP !== undefined && { INP: metricSavings.INP }),
      ...(metricSavings.CLS !== undefined && { CLS: metricSavings.CLS }),
    };
    return [
      {
        name,
        title: textOf(title),
        state,
        ...(state !== "pass" && { description: textOf(description) }),
        ...(savings && Object.keys(savings).length > 0 && { savings }),
      },
    ];
  });
  const summary: TraceSummary = { url: set.url.href, insights };

  if (mode === "load") {
    const lcp = Common.getLCP(set);
    if (!lcp) {
      throw refuse({ code: "no_lcp", message: "The page load painted no LCP candidate." });
    }
    const breakdown = Common.getInsight("LCPBreakdown", set);
    const subparts = Object.fromEntries(
      Object.entries(breakdown?.subparts ?? {}).map(([part, window]) => [part, toMs(window.range)]),
    );
    summary.lcp = { ms: toMs(lcp.value), subparts };
    summary.cls = Common.getCLS(set).value;
  } else {
    const inp = Common.getINP(set);
    if (inp) summary.inp = { ms: toMs(inp.value), type: inp.event.type };
  }
  return summary;
}
