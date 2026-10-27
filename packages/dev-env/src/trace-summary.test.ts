import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { summarizeTrace } from "./trace-summary.ts";

// Traces `cw verify trace` recorded of `fixtures/trace-page.html` at 1280×800. The expected values
// were checked against the browser's own Web Performance API entries on the same document when they
// were recorded: layout-shift 0.021051, largest-contentful-paint 44 ms (rounded), event timing
// 272 ms. A trace engine upgrade that reads them differently fails here.
function fixture(name: string): unknown[] {
  const file = join(import.meta.dirname, "fixtures", `${name}.trace.json.gz`);
  const trace: unknown = JSON.parse(gunzipSync(readFileSync(file)).toString());
  const events: unknown =
    typeof trace === "object" && trace !== null ? Reflect.get(trace, "traceEvents") : undefined;
  if (!Array.isArray(events)) throw new Error(`${file} holds no traceEvents`);
  return events;
}

type Event = { name?: string; cat?: string; args?: { data?: { interactionId?: number } } };

/** A fixture's event, as written by Chrome. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- fixtures Chrome recorded
const asEvent = (event: unknown) => event as Event;

describe("summarizeTrace", () => {
  it("reads a page load's LCP, CLS and insights", async () => {
    const summary = await summarizeTrace({ events: fixture("load"), mode: "load" });

    expect(summary.url).toBe("http://127.0.0.1:47812/trace-page.html");
    expect(summary.lcp?.ms).toBeCloseTo(41.006, 2);
    expect(summary.cls).toBeCloseTo(0.021051, 6);
    expect(summary.inp).toBeUndefined();
    expect(summary.insights.filter(({ state }) => state === "fail")).toEqual([]);
    expect(summary.insights.map(({ name }) => name)).toEqual(
      expect.arrayContaining(["LCPBreakdown", "CLSCulprits", "RenderBlocking", "DocumentLatency"]),
    );
    expect(summary.insights.find(({ name }) => name === "CLSCulprits")).toMatchObject({
      state: "informative",
      title: "Layout shift culprits",
    });
  });

  it("measures the page, not the about:blank load a throttled trace can catch first", async () => {
    // Recorded with 4× CPU and Slow 4G: the about:blank navigation landed inside the trace.
    const summary = await summarizeTrace({ events: fixture("throttled"), mode: "load" });

    expect(summary.url).toBe("http://127.0.0.1:47812/trace-page.html");
    expect(summary.lcp?.ms).toBeCloseTo(646.844, 2);
    expect(summary.cls).toBeCloseTo(0.021051, 6);
  });

  it("reads an interaction's INP, and the insight that fails on it", async () => {
    const summary = await summarizeTrace({ events: fixture("click"), mode: "interaction" });

    expect(summary.inp?.ms).toBeCloseTo(271.726, 2);
    expect(
      summary.insights.filter(({ state }) => state === "fail").map(({ name }) => name),
    ).toEqual(["INPBreakdown"]);
  });

  it("refuses as incomplete_trace when the trace has no loading events, rather than CLS 0", async () => {
    const events = fixture("load").filter(
      (event) => !asEvent(event).cat?.split(",").includes("loading"),
    );

    await expect(summarizeTrace({ events, mode: "load" })).rejects.toMatchObject({
      code: "incomplete_trace",
    });
  });

  it("refuses as no_navigation when a page-load trace holds no load of the page", async () => {
    await expect(summarizeTrace({ events: fixture("click"), mode: "load" })).rejects.toMatchObject({
      code: "no_navigation",
    });
  });

  it("refuses as no_interaction when the steps produced no interaction", async () => {
    const events = fixture("click").filter(
      (event) =>
        (asEvent(event).args?.data?.interactionId ?? 0) === 0 &&
        asEvent(event).name !== "EventTiming",
    );

    await expect(summarizeTrace({ events, mode: "interaction" })).rejects.toMatchObject({
      code: "no_interaction",
    });
  });

  it("refuses as unreadable_trace when there's nothing to read", async () => {
    await expect(summarizeTrace({ events: [], mode: "load" })).rejects.toMatchObject({
      code: "unreadable_trace",
    });
  });
});
