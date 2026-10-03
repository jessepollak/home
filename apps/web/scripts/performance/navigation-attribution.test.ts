import { describe, expect, test } from "bun:test";
import { attributeWindow, summarizeLoaf, type LoafEntry, type TraceEvent } from "./attribution";
import { aggregateAttribution, aggregateWebKit, attributionMarkdown, awaitTraceEnd, drainTailFrames, endTraceWithDeadline, latencySummary, mapTraceWindows, overheadDelta, sliceLoaf, summarizeLoafWindow, topInvokerByPath,
  type NavigationAttributionSample, type NavigationLeg, type NavigationWindow, type WebKitSample } from "./navigation-attribution";
import { aggregateReact } from "./react-attribution";

const windows = (): NavigationWindow[] => [
  { path: "/cash", leg: "outbound", cycle: 1, latencyMs: 20, startMs: 10, endMs: 110, startMark: "out-start", endMark: "out-end" },
  { path: "/cash", leg: "home", cycle: 1, latencyMs: 30, startMs: 120, endMs: 220, startMark: "home-start", endMark: "home-end" },
];
const marks = (measured = windows()): TraceEvent[] => measured.flatMap((window) => [
  { name: window.startMark, ts: window.startMs * 1000, cat: "blink.user_timing" },
  { name: window.endMark, ts: window.endMs * 1000, cat: "blink.user_timing" },
]);
function firstWindow(): NavigationWindow {
  const [first] = windows();
  if (!first) throw new Error("Test fixture is missing its first window");
  return first;
}
function firstMark(): TraceEvent {
  const [first] = marks();
  if (!first) throw new Error("Test fixture is missing its first mark");
  return first;
}
const loaf = (startMs: number, durationMs = 60, invoker = "click", forcedStyleAndLayoutMs = 10): LoafEntry => ({
  startMs, durationMs, blockingMs: 10, styleAndLayoutMs: 15,
  scripts: [{ invoker, invokerType: "event-listener", durationMs: 30, forcedStyleAndLayoutMs }],
});
function sample(latencyMs: number, leg: NavigationLeg, scriptMs: number): NavigationAttributionSample {
  const attributed = attributeWindow([
    { name: "thread_name", ph: "M", pid: 1, tid: 1, args: { name: "CrRendererMain" } },
    { name: "FunctionCall", ph: "X", ts: 0, dur: scriptMs * 1000, pid: 1, tid: 1 },
  ], { start: 0, end: 100_000 });
  return { path: "/cash", cycle: 1, leg, latencyMs, ...attributed, presentedMs: latencyMs + 5,
    pipeline: [{ step: "Commit", startMs: 0, endMs: scriptMs, durationMs: scriptMs }],
    ...summarizeLoafWindow({ supported: true, entries: [loaf(10, 60, "click", scriptMs)] }, { startMs: 0, endMs: 100 }), react: null, reactReason: null };
}

function timers() {
  let fire: () => void = () => { throw new Error("Deadline timer was not set"); };
  const handle = {}, delays: number[] = [], cleared: unknown[] = [];
  return { handle, delays, cleared, fire: () => fire(),
    set: (callback: () => void, ms: number) => { fire = callback; delays.push(ms); return handle; },
    clear: (timer: unknown) => { cleared.push(timer); } };
}

describe("bounded trace stop", () => {
  test("a never-answering stop settles at the injected deadline without retrying", async () => {
    const clock = timers();
    let calls = 0, settled = false;
    const ending = endTraceWithDeadline(() => { calls++; return new Promise<unknown>(() => {}); }, 1234, clock)
      .then(() => { settled = true; });
    await Promise.resolve();
    expect(calls).toBe(1);
    expect(settled).toBe(false);
    expect(clock.delays).toEqual([1234]);
    clock.fire();
    await ending;
    expect(settled).toBe(true);
    expect(calls).toBe(1);
    expect(clock.cleared).toEqual([clock.handle]);
  });
  test("a resolving stop clears its timer and defaults to a five-second deadline", async () => {
    const clock = timers();
    await expect(endTraceWithDeadline(() => Promise.resolve({}), undefined, clock)).resolves.toBeUndefined();
    expect(clock.delays).toEqual([5000]);
    expect(clock.cleared).toEqual([clock.handle]);
  });
  test("a rejecting stop resolves and clears its timer", async () => {
    const clock = timers();
    await expect(endTraceWithDeadline(() => Promise.reject(new Error("CDP disconnected")), 50, clock)).resolves.toBeUndefined();
    expect(clock.delays).toEqual([50]);
    expect(clock.cleared).toEqual([clock.handle]);
  });
  test("both trace-end signals resolve with the completion value and clear the timer", async () => {
    const clock = timers(), completion = { dataLossOccurred: false };
    await expect(awaitTraceEnd(Promise.resolve({}), Promise.resolve(completion), undefined, clock)).resolves.toBe(completion);
    expect(clock.delays).toEqual([20_000]);
    expect(clock.cleared).toEqual([clock.handle]);
  });
  test("completion before a never-answering acknowledgement still rejects at the deadline", async () => {
    const clock = timers();
    const finished = awaitTraceEnd(new Promise<unknown>(() => {}), Promise.resolve({}), 1234, clock);
    await Promise.resolve();
    expect(clock.delays).toEqual([1234]);
    expect(clock.cleared).toEqual([]);
    clock.fire();
    await expect(finished).rejects.toEqual(new Error("Navigation attribution trace did not finish within 20 s"));
    expect(clock.cleared).toEqual([clock.handle]);
  });
  test("acknowledgement before a never-arriving completion still rejects at the deadline", async () => {
    const clock = timers();
    const finished = awaitTraceEnd(Promise.resolve({}), new Promise<{ dataLossOccurred?: boolean }>(() => {}), 1234, clock);
    await Promise.resolve();
    expect(clock.delays).toEqual([1234]);
    expect(clock.cleared).toEqual([]);
    clock.fire();
    await expect(finished).rejects.toEqual(new Error("Navigation attribution trace did not finish within 20 s"));
    expect(clock.cleared).toEqual([clock.handle]);
  });
  test("a trace-end rejection propagates unchanged and clears its timer", async () => {
    for (const side of ["ending", "completed"] as const) {
      const clock = timers(), failure = new Error("CDP disconnected");
      const ending = side === "ending" ? Promise.reject(failure) : new Promise<unknown>(() => {});
      const completed = side === "completed" ? Promise.reject(failure) : new Promise<{ dataLossOccurred?: boolean }>(() => {});
      await expect(awaitTraceEnd(ending, completed, 50, clock)).rejects.toBe(failure);
      expect(clock.delays).toEqual([50]);
      expect(clock.cleared).toEqual([clock.handle]);
    }
  });
});
describe("bounded tail-frame drain", () => {
  test("settles after the count holds steady for the quiet window, defaults to two seconds and clears its timer", async () => {
    const clock = timers();
    let evaluations = 0;
    await expect(drainTailFrames(() => { evaluations++; return Promise.resolve(0); }, undefined, clock)).resolves.toBeUndefined();
    expect(evaluations).toBe(4);
    expect(clock.delays).toEqual([2000]);
    expect(clock.cleared).toEqual([clock.handle]);
  });
  test("a newly reported entry restarts the quiet window", async () => {
    const clock = timers();
    const values = [0, 0, 1, 1, 1, 1];
    let evaluations = 0;
    const evaluate = () => Promise.resolve(values[Math.min(evaluations++, values.length - 1)] ?? 0);
    await expect(drainTailFrames(evaluate, 5000, clock)).resolves.toBeUndefined();
    expect(evaluations).toBe(6);
    expect(clock.delays).toEqual([5000]);
    expect(clock.cleared).toEqual([clock.handle]);
  });
  test("a rejecting evaluate counts as unavailable and still settles", async () => {
    const clock = timers();
    await expect(drainTailFrames(() => Promise.reject(new Error("page closed")), 75, clock)).resolves.toBeUndefined();
    expect(clock.delays).toEqual([75]);
    expect(clock.cleared).toEqual([clock.handle]);
  });
  test("a stalled renderer settles at the injected deadline and swallows a late rejection", async () => {
    const clock = timers();
    let fail: (error: Error) => void = () => {};
    const drained = drainTailFrames(() => new Promise<number>((_, reject) => { fail = reject; }), 50, clock);
    await Promise.resolve();
    expect(clock.delays).toEqual([50]);
    expect(clock.cleared).toEqual([]);
    clock.fire();
    await expect(drained).resolves.toBeUndefined();
    fail(new Error("page closed"));
    await Promise.resolve();
    expect(clock.cleared).toEqual([clock.handle]);
  });
});

describe("navigation attribution windows", () => {
  test("maps trace and page-clock windows in cycle/leg order despite shuffled events", () => {
    const mapped = mapTraceWindows(marks().reverse(), windows(), 1);
    expect(mapped.map(({ leg, traceWindow, startMs, endMs }) => ({ leg, traceWindow, startMs, endMs }))).toEqual([
      { leg: "outbound", traceWindow: { start: 10_000, end: 110_000 }, startMs: 10, endMs: 110 },
      { leg: "home", traceWindow: { start: 120_000, end: 220_000 }, startMs: 120, endMs: 220 },
    ]);
    expect(mapTraceWindows([], [], 0)).toEqual([]);
  });
  test("missing leg and a wrong cycle/leg cannot silently reduce samples", () => {
    expect(() => mapTraceWindows(marks(), windows().slice(0, 1), 1)).toThrow("window/leg mismatch");
    expect(() => mapTraceWindows(marks(), windows().map((window) => ({ ...window, leg: "outbound" })), 1)).toThrow("missing or out-of-order leg");
    expect(() => mapTraceWindows(marks(), windows().map((window) => ({ ...window, cycle: 2 })), 1)).toThrow("missing or out-of-order leg");
  });
  test("return-only home/back windows allow consistent per-leg paths across cycles", () => {
    const returns: NavigationWindow[] = [1, 2].flatMap((cycle) => windows().map((window, index) => ({ ...window, cycle,
      leg: index === 0 ? "home" : "back", path: index === 0 ? "Back (Home tab)" : "Back (browser history)",
      startMs: window.startMs + (cycle - 1) * 300, endMs: window.endMs + (cycle - 1) * 300,
      startMark: `${cycle}-${window.startMark}`, endMark: `${cycle}-${window.endMark}` })));
    const legs = ["home", "back"] as const;
    expect(mapTraceWindows(marks(returns).reverse(), returns, 2, false, legs).map(({ path, leg, cycle }) => ({ path, leg, cycle }))).toEqual([
      { path: "Back (Home tab)", leg: "home", cycle: 1 }, { path: "Back (browser history)", leg: "back", cycle: 1 },
      { path: "Back (Home tab)", leg: "home", cycle: 2 }, { path: "Back (browser history)", leg: "back", cycle: 2 },
    ]);
    expect(() => mapTraceWindows(marks(returns), returns, 2, false, ["back", "home"])).toThrow("missing or out-of-order leg");
    expect(() => mapTraceWindows(marks(returns), returns.slice(0, -1), 2, false, legs)).toThrow("window/leg mismatch");
    expect(() => mapTraceWindows(marks(returns), returns.map((window, index) => index === 2 ? { ...window, cycle: 1 } : window), 2, false, legs)).toThrow("missing or out-of-order leg");
    expect(() => mapTraceWindows(marks(returns), returns.map((window, index) => index === 2 ? { ...window, path: "different" } : window), 2, false, legs)).toThrow("missing or out-of-order leg");
  });
  test("single-leg detail windows retain cycle validation and trace mapping", () => {
    const details: NavigationWindow[] = windows().map((window, index) => ({ ...window, path: "Activity detail", leg: "detail", cycle: index + 1 }));
    expect(mapTraceWindows(marks(details), details, 2, false, ["detail"]).map(({ leg, cycle }) => ({ leg, cycle }))).toEqual([
      { leg: "detail", cycle: 1 }, { leg: "detail", cycle: 2 },
    ]);
    expect(() => mapTraceWindows(marks(details), details, 1, false, ["detail"])).toThrow("window/leg mismatch");
  });
  test("unmatched, duplicate, wrong-category and reversed marks fail loudly", () => {
    expect(() => mapTraceWindows(marks().slice(1), windows(), 1)).toThrow("unmatched");
    expect(() => mapTraceWindows([...marks(), firstMark()], windows(), 1)).toThrow("unmatched");
    expect(() => mapTraceWindows(marks().map((event) => ({ ...event, cat: "other" })), windows(), 1)).toThrow("unmatched");
    expect(() => mapTraceWindows(marks().map((event) => event.name === "out-end" ? { ...event, ts: 1 } : event), windows(), 1)).toThrow("unmatched");
  });
  test("page-clock overlap and reused mark names fail", () => {
    expect(() => mapTraceWindows(marks(), windows().map((window) => ({ ...window, endMs: window.startMs })), 1)).toThrow("page-clock");
    const duplicateNames = windows();
    const [original, duplicate] = duplicateNames;
    if (!original || !duplicate) throw new Error("Test fixture is missing a window to duplicate");
    duplicate.startMark = original.startMark;
    expect(() => mapTraceWindows(marks(), duplicateNames, 1)).toThrow("mark names must be distinct");
  });
  test("trace data loss fails even with otherwise valid or empty windows", () => {
    expect(() => mapTraceWindows(marks(), windows(), 1, true)).toThrow("trace reported data loss");
    expect(() => mapTraceWindows([], [], 0, true)).toThrow("trace reported data loss");
  });
  test("LoAF slices use page-clock half-open start membership and the 50 ms threshold", () => {
    const entries = [loaf(9), loaf(10, 50), loaf(100, 49), loaf(109, 80), loaf(110)];
    const sliced = sliceLoaf(entries, firstWindow());
    expect(sliced.map((entry) => entry.startMs)).toEqual([10, 109]);
    expect(summarizeLoaf(sliced)).toMatchObject({ count: 2, totalMs: 130, blockingMs: 20, maxMs: 80, forcedStyleAndLayoutMs: 20, topInvoker: "click" });
    expect(sliceLoaf([], firstWindow())).toEqual([]);
  });
});

describe("LoAF top invoker by path", () => {
  test("each Back path selects its own highest-duration invoker without leaking across paths", () => {
    const home = loaf(10, 60, "home-click");
    home.scripts.push({ invoker: "home-secondary", invokerType: "event-listener", durationMs: 10, forcedStyleAndLayoutMs: 0 });
    const history = { ...loaf(120, 90, "history-popstate"),
      scripts: [{ invoker: "history-popstate", invokerType: "event-listener", durationMs: 80, forcedStyleAndLayoutMs: 0 }] };
    expect(topInvokerByPath([home, history], [
      { path: "Back (Home tab)", startMs: 10, endMs: 110 },
      { path: "Back (browser history)", startMs: 120, endMs: 220 },
    ])).toEqual({ "Back (Home tab)": "home-click", "Back (browser history)": "history-popstate" });
  });
  test("sums script durations across a path's windows and breaks ties by name", () => {
    const first = loaf(10, 60, "zeta"), second = loaf(120, 60, "zeta");
    const competitor = { invoker: "alpha", invokerType: "event-listener", durationMs: 40, forcedStyleAndLayoutMs: 0 };
    first.scripts.push(competitor);
    const measured = [
      { path: "/cash", startMs: 10, endMs: 110 },
      { path: "/cash", startMs: 120, endMs: 220 },
    ];
    expect(topInvokerByPath([first, second], measured)).toEqual({ "/cash": "zeta" });
    competitor.durationMs = 60;
    expect(topInvokerByPath([first, second], measured)).toEqual({ "/cash": "alpha" });
  });
  test("paths without qualifying entries return null", () => {
    expect(topInvokerByPath([loaf(10, 49), loaf(110)], [
      { path: "short", startMs: 10, endMs: 110 },
      { path: "empty", startMs: 120, endMs: 220 },
    ])).toEqual({ short: null, empty: null });
    expect(topInvokerByPath([], [{ path: "empty", startMs: 0, endMs: 100 }])).toEqual({ empty: null });
  });
  test("no windows returns an empty mapping", () => {
    expect(topInvokerByPath([], [])).toEqual({});
    expect(topInvokerByPath([loaf(10)], [])).toEqual({});
  });
});

describe("navigation attribution aggregation", () => {
  test("empty measurements are unavailable, not fabricated zeros", () => {
    expect(latencySummary([])).toEqual({ samples: 0, p50: null, p95: null });
    const aggregated = aggregateAttribution("/cash", [], []);
    expect(aggregated.main.scriptMs).toBeNull();
    expect(aggregated.threads.rasterMs).toBeNull();
    expect(aggregated.windowMs).toBeNull();
    expect(aggregated.presented.p95).toBeNull();
    expect(aggregated.loaf).toBeNull();
    expect(aggregated.frames).toEqual([]);
    expect(aggregated.pipeline).toEqual([]);
    expect(aggregated.overhead.p50DeltaMs).toBeNull();
  });
  test("pools both legs, filters paths, uses medians, totals LoAF and preserves thread unavailability", () => {
    const outbound = sample(20, "outbound", 10), inbound = sample(40, "home", 30);
    outbound.threads.rasterMs = null; inbound.threads.rasterMs = null;
    const aggregated = aggregateAttribution("/cash", [outbound, inbound, { ...outbound, path: "/invest", latencyMs: 999 }], [10, 30], "click");
    expect(aggregated.latency).toEqual({ samples: 2, p50: 30, p95: 40 });
    expect(aggregated.presented).toEqual({ samples: 2, p50: 35, p95: 45 });
    expect(aggregated.main).toMatchObject({ scriptMs: 20, busyMs: 20, paintMs: 0 });
    expect(aggregated.threads.rasterMs).toBeNull();
    expect(aggregated.pipeline).toEqual([{ step: "Commit", samples: 2, durationMs: 20 }]);
    expect(aggregated.loaf).toMatchObject({ samples: 2, count: 2, totalMs: 120, blockingMs: 20, maxMs: 60, forcedStyleAndLayoutMs: 40, topInvoker: "click" });
    expect(aggregated.loaf?.forcedSharePct).toBeCloseTo(100 / 3);
  });
  test("missing presented frames/LoAF support do not bias available medians toward zero", () => {
    const available = sample(20, "outbound", 10), missing = { ...sample(40, "home", 30), presentedMs: null, pipeline: [], main: null,
      ...summarizeLoafWindow({ supported: false, entries: [loaf(10)] }, firstWindow()) };
    expect(missing.loafFrames).toBeNull();
    expect(aggregateAttribution("/cash", [missing], []).frames).toEqual([]);
    const aggregated = aggregateAttribution("/cash", [available, missing], []);
    expect(aggregated.presented).toEqual({ samples: 1, p50: 25, p95: 25 });
    expect(aggregated.main.scriptMs).toBe(10);
    expect(aggregated.pipeline).toEqual([{ step: "Commit", samples: 1, durationMs: 10 }]);
    expect(aggregated.loaf?.samples).toBe(1);
  });
  test("two frames in one window keep their individual script and forced-layout attribution in JSON and Markdown", () => {
    const window = firstWindow();
    const attributed = { ...sample(20, "outbound", 10),
      ...summarizeLoafWindow({ supported: true, entries: [loaf(20, 60, "click", 12), loaf(90, 80, "animation-frame", 4)] }, window) };
    expect(attributed.loafFrames).toEqual([
      { startMs: 10, durationMs: 60, blockingMs: 10, styleAndLayoutMs: 15, forcedStyleAndLayoutMs: 12, forcedSharePct: 20, invoker: "click", invokerMs: 30 },
      { startMs: 80, durationMs: 80, blockingMs: 10, styleAndLayoutMs: 15, forcedStyleAndLayoutMs: 4, forcedSharePct: 5, invoker: "animation-frame", invokerMs: 30 },
    ]);
    const aggregated = aggregateAttribution("/cash", [attributed, { ...attributed, path: "/invest" }], []);
    expect(JSON.parse(JSON.stringify(aggregated)).frames).toEqual([
      { startMs: 10, durationMs: 60, blockingMs: 10, styleAndLayoutMs: 15, forcedStyleAndLayoutMs: 12, forcedSharePct: 20, invoker: "click", invokerMs: 30, leg: "outbound", cycle: 1 },
      { startMs: 80, durationMs: 80, blockingMs: 10, styleAndLayoutMs: 15, forcedStyleAndLayoutMs: 4, forcedSharePct: 5, invoker: "animation-frame", invokerMs: 30, leg: "outbound", cycle: 1 },
    ]);
    const lines = attributionMarkdown({ rows: 300, pooling: "cycles and measured legs per path", chromium: [aggregated], samples: [attributed], plainLatenciesByPath: {}, react: null,
      webkit: { browser: null, samples: [], paths: [], errors: [] } });
    expect(lines).toContain("#### Long animation frames (per frame, start in window, ≥50 ms)");
    expect(lines).toContain("| Window | Start | Duration | Blocking | Style + layout phase | Forced style + layout | Forced share | Top script invoker |");
    expect(lines).toContain("| /cash outbound #1 | 10 | 60 | 10 | 15 | 12 | 20% | click |");
    expect(lines).toContain("| /cash outbound #1 | 80 | 80 | 10 | 15 | 4 | 5% | animation-frame |");
  });
  test("supported windows without long frames stay empty, not unavailable", () => {
    const empty = summarizeLoafWindow({ supported: true, entries: [loaf(10, 49), loaf(110, 60)] }, firstWindow());
    expect(empty.loafFrames).toEqual([]);
    expect(empty.loaf).toMatchObject({ count: 0 });
    expect(aggregateAttribution("/cash", [{ ...sample(20, "outbound", 10), ...empty }], []).frames).toEqual([]);
  });
  test("overhead compares distribution p50/p95 with signed deltas and explicit counts", () => {
    expect(overheadDelta([10, 20, 30], [5, 10, 100, 150])).toEqual({
      plain: { samples: 3, p50: 20, p95: 30 }, attribution: { samples: 4, p50: 55, p95: 150 }, p50DeltaMs: 35, p95DeltaMs: 120,
    });
    expect(overheadDelta([40, 60], [10, 20])).toMatchObject({ p50DeltaMs: -35, p95DeltaMs: -40 });
    expect(overheadDelta([], [10])).toMatchObject({ p50DeltaMs: null, p95DeltaMs: null });
    expect(overheadDelta([10], [])).toMatchObject({ p50DeltaMs: null, p95DeltaMs: null });
  });
  test("WebKit pools raw frame gaps and counts strictly over 50 ms", () => {
    const create = (latencyMs: number, frameGaps: number[]): WebKitSample => ({ path: "/cash", cycle: 1, leg: "outbound", latencyMs, frameGaps,
      frameGapP95Ms: null, frameGapMaxMs: null, longFrameCount: 0 });
    expect(aggregateWebKit("/cash", [create(10, [16, 50]), create(30, [60, 80])])).toEqual({
      path: "/cash", latency: { samples: 2, p50: 20, p95: 30 }, frames: 4, frameGapP95Ms: 80, frameGapMaxMs: 80, longFrameCount: 2,
    });
    expect(aggregateWebKit("/cash", [])).toMatchObject({ frameGapP95Ms: null, frameGapMaxMs: null, longFrameCount: null });
  });
  test("Back and Activity detail aggregate separately and render every path table with unavailable buckets", () => {
    const paths = ["Back (Home tab)", "Back (browser history)", "Activity detail"];
    const samples = paths.map((path, index): NavigationAttributionSample => ({ ...sample((index + 1) * 10, index === 0 ? "home" : index === 1 ? "back" : "detail", 5), path,
      main: null, threads: { rasterMs: null, compositorMs: null, gpuMs: null, vizMs: null }, presentedMs: null, pipeline: [], loaf: null, loafFrames: null }));
    const chromium = paths.map((path) => aggregateAttribution(path, samples, []));
    const react = { url: null, samples: [], paths: paths.map((path) => aggregateReact(path, samples)), hooks: [], reason: "No profiling build configured" };
    const lines = attributionMarkdown({ rows: 300, pooling: "cycles and measured legs per path", chromium, samples, plainLatenciesByPath: {}, react,
      webkit: { browser: null, samples: [], paths: paths.map((path) => aggregateWebKit(path, [])), errors: [] } });
    for (const [index, path] of paths.entries()) {
      const row = chromium[index];
      expect(row?.latency).toEqual({ samples: 1, p50: (index + 1) * 10, p95: (index + 1) * 10 });
      expect(row?.main.scriptMs).toBeNull();
      expect(row?.threads.rasterMs).toBeNull();
      expect(row?.loaf).toBeNull();
      expect(row?.presented.p50).toBeNull();
      expect(row?.overhead.plain.p50).toBeNull();
      expect(row?.overhead.p50DeltaMs).toBeNull();
      expect(aggregateWebKit(path, []).frameGapP95Ms).toBeNull();
      expect(aggregateReact(path, samples).renderMs).toBeNull();
      expect(lines.filter((line) => line.startsWith(`| ${path} |`))).toHaveLength(9);
      expect(lines).toContain(`| ${path} | — | — | — | — | — | — | — | — |`);
      expect(lines).toContain(`| ${path} | — | — | — | — | — | — | — | — | — |`);
      expect(lines).toContain(`| ${path} | 0 | — | — | 0 | — | — | — |`);
    }
    expect(lines.join("\n")).toContain("Back returns to Home from /cash");
    expect(lines.join("\n")).toContain("click → dialog visible");
    expect(lines.join("\n")).toContain("pooled over cycles and measured legs per path");
  });
  test("Markdown names report-only, unavailability and WebKit failures without fake zero timing", () => {
    const lines = attributionMarkdown({ rows: 300, pooling: "cycles and measured legs per path", chromium: [aggregateAttribution("/cash", [], [])], samples: [], plainLatenciesByPath: {}, react: null,
      webkit: { browser: null, samples: [], paths: [aggregateWebKit("/cash", [])], errors: [{ path: "/cash", reason: "engine unavailable" }] } });
    expect(lines).toContain("## Navigation attribution (report only)");
    expect(lines).toContain("### Desktop WebKit");
    expect(lines).toContain("WebKit: latency and frame gaps only; Chromium traces and long-animation-frame entries are not available in this engine.");
    expect(lines).toContain("WebKit failure (/cash): engine unavailable");
    expect(lines).toContain("| /cash | 0 | — | — | — | 0 | — | — |");
    expect(lines).toContain("| /cash | — | — | — | — | — | — | — |");
    expect(attributionMarkdown(null).join("\n")).toContain("Attribution runs only");
  });
});
