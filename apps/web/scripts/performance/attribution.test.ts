import { describe, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { attributeWindow, loafCollectorSource, loafFrames, mainThread, markWindows, summarizeLoaf, type LoafEntry, type TraceEvent } from "./attribution";

const metadata = (name: string, pid = 1, tid = 1): TraceEvent => ({ name: "thread_name", ph: "M", pid, tid, args: { name } });
const complete = (name: string, ts: number, dur: number, pid = 1, tid = 1): TraceEvent => ({ name, ph: "X", ts, dur, pid, tid });
const pair = (name: string, start: number, end: number, pid = 1, tid = 1, async = false, id?: string): TraceEvent[] => [
  { name, ph: async ? "b" : "B", ts: start, pid, tid, ...(id ? { id2: { local: id } } : {}) },
  { name, ph: async ? "e" : "E", ts: end, pid, tid, ...(id ? { id2: { local: id } } : {}) },
];
const main = metadata("CrRendererMain");
const window = { start: 0, end: 30_000 };
const stageOrder = [
  "BeginImplFrameToSendBeginMainFrame", "SendBeginMainFrameToCommit", "Commit", "EndCommitToActivation",
  "EndActivateToSubmitCompositorFrame", "SubmitCompositorFrameToPresentationCompositorFrame", "SubmitToReceiveCompositorFrame",
  "ReceiveCompositorFrameToStartDraw", "StartDrawToSwapStart", "SwapEndToPresentationCompositorFrame", "LatchToSwapEnd",
];
function pipeline(start: number, id?: string, async = false, tid = 2): TraceEvent[] {
  const durations = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 10], [5, 6], [6, 7], [7, 8], [9, 10], [8, 9]];
  return stageOrder.flatMap((name, index) => {
    const [from = 0, to = 0] = durations[index] ?? [];
    return pair(name, start + from * 1000, start + to * 1000, 2, tid, async, id)
      .map((event) => ({ ...event, cat: "cc,benchmark,disabled-by-default-devtools.timeline.frame" }));
  });
}

describe("main-thread attribution", () => {
  test("pair-only style/layout is forced inside script, lifecycle outside it", () => {
    const events = [main, ...pair("FunctionCall", 0, 10_000), ...pair("UpdateLayoutTree", 1000, 3000), ...pair("Layout", 3000, 7000),
      ...pair("AnimationFrame::StyleAndLayout", 12_000, 20_000), ...pair("UpdateLayoutTree", 12_000, 14_000), ...pair("Layout", 14_000, 20_000)];
    expect(attributeWindow(events, window).main).toEqual({
      busyMs: 18, scriptMs: 4, forcedStyleMs: 2, forcedLayoutMs: 4, lifecycleStyleMs: 2, lifecycleLayoutMs: 6, paintMs: 0, otherMs: 0,
    });
  });

  test("script self time removes nested layout, not every nested event", () => {
    const events = [main, complete("RunTask", 0, 10_000), complete("FunctionCall", 0, 10_000), ...pair("Layout", 2000, 6000), complete("InternalWork", 0, 1000)];
    expect(attributeWindow(events, window).main).toMatchObject({ busyMs: 10, scriptMs: 6, forcedLayoutMs: 4, otherMs: 0 });
  });

  test("nested script, layout aliases, paint wrappers and unknown work never double count", () => {
    const events = [main, complete("RunTask", 0, 12_000), complete("EventDispatch", 0, 10_000), complete("FunctionCall", 0, 10_000),
      complete("UpdateLayoutTree", 1000, 1000), complete("LocalFrameView::layout", 2000, 4000), complete("Layout", 2000, 4000),
      complete("LocalFrameView::performLayout", 2500, 3000), complete("LocalFrameView::RunPaintLifecyclePhase", 6000, 2000), complete("Paint", 6500, 1000)];
    expect(attributeWindow(events, window).main).toEqual({ busyMs: 12, scriptMs: 3, forcedStyleMs: 1, forcedLayoutMs: 4, lifecycleStyleMs: 0, lifecycleLayoutMs: 0, paintMs: 2, otherMs: 2 });
  });

  test("wrapper self time counts as style and nested layout/paint own their time", () => {
    const events = [main, complete("LocalFrameView::RunStyleAndLayoutLifecyclePhases", 0, 10_000), complete("Layout", 2000, 4000), complete("Paint", 7000, 1000)];
    expect(attributeWindow(events, window).main).toMatchObject({ busyMs: 10, lifecycleStyleMs: 5, lifecycleLayoutMs: 4, paintMs: 1 });
  });

  test("async style labels only attribute synchronous busy time", () => {
    const events = [main, ...pair("AnimationFrame::StyleAndLayout", 0, 10_000, 1, 1, true, "frame"), complete("RunTask", 1000, 3000),
      ...pair("Layout", 2000, 3000, 1, 1, true, "frame")];
    expect(attributeWindow(events, window).main).toMatchObject({ busyMs: 3, lifecycleStyleMs: 2, lifecycleLayoutMs: 1 });
    expect(attributeWindow([main, ...pair("Layout", 15_000, 20_000, 1, 1, true)], window).main).toEqual(attributeWindow([], window).main);
    expect(attributeWindow([...events, ...pair("Layout", 15_000, 20_000, 1, 1, true)], window)).toEqual(attributeWindow(events, window));
  });

  test("clips across window boundaries but determines forced ancestry before clipping", () => {
    const events = [main, complete("RunTask", 0, 15_000), complete("FunctionCall", 0, 10_000), ...pair("Layout", 2000, 8000)];
    expect(attributeWindow(events, { start: 5000, end: 12_000 }).main).toMatchObject({ busyMs: 7, scriptMs: 2, forcedLayoutMs: 3, otherMs: 2 });
    expect(attributeWindow([main, complete("FunctionCall", 0, 5000), complete("Paint", 12_000, 1000)], { start: 5000, end: 12_000 }).main.busyMs).toBe(0);
  });

  test("pairs repeated same-name events LIFO, drops unmatched pairs and sorts shuffled events", () => {
    const events = [main, ...pair("FunctionCall", 0, 10_000), ...pair("Layout", 1000, 7000), ...pair("Layout", 2000, 4000),
      { name: "Paint", ph: "B", ts: 9000, pid: 1, tid: 1 }, { name: "UpdateLayoutTree", ph: "E", ts: 500, pid: 1, tid: 1 }];
    const expected = attributeWindow(events, window);
    expect(expected.main).toMatchObject({ busyMs: 10, scriptMs: 4, forcedLayoutMs: 6 });
    expect(attributeWindow(events.toReversed(), window)).toEqual(expected);
  });

  test("every supported script name is recognized", () => {
    for (const name of ["EventDispatch", "FunctionCall", "EvaluateScript", "FireAnimationFrame", "TimerFire", "FireIdleCallback", "v8.run", "RunMicrotasks"])
      expect(attributeWindow([main, ...pair(name, 0, 2000), ...pair("Layout", 0, 1000)], window).main).toMatchObject({ scriptMs: 1, forcedLayoutMs: 1 });
  });

  test("missing metadata, empty/malformed traces and inverted/non-finite windows are safe", () => {
    expect(mainThread([])).toBeNull();
    expect(attributeWindow([complete("FunctionCall", 0, 1000)], window).main.busyMs).toBe(0);
    for (const invalid of [{ start: 10, end: 5 }, { start: 5, end: 5 }, { start: NaN, end: 10 }])
      expect(attributeWindow([main, complete("FunctionCall", 0, 1000)], invalid)).toEqual(attributeWindow([], { start: 0, end: 0 }));
    expect(attributeWindow([main, {}, complete("FunctionCall", NaN, 1000), complete("Layout", 0, -1000)], window).main.busyMs).toBe(0);
    const candidates = [metadata("CrRendererMain", 2, 4), main];
    expect(mainThread(candidates)).toEqual({ pid: 1, tid: 1 });
    expect(mainThread(candidates.toReversed())).toEqual({ pid: 1, tid: 1 });
  });

  test("milliseconds are rounded to three decimal places", () => {
    expect(attributeWindow([main, complete("FunctionCall", 0, 1234.567)], { start: 0, end: 2345.678 })).toMatchObject({ windowMs: 2.346, main: { busyMs: 1.235, scriptMs: 1.235 } });
  });
});

describe("thread busy time", () => {
  test("unions overlap on one thread, sums distinct threads and ignores async spans and unknown threads", () => {
    const events = [metadata("CompositorTileWorker1", 2, 1), metadata("CompositorTileWorker2", 2, 2), metadata("Compositor", 3, 1),
      metadata("CrGpuMain", 4, 1), metadata("GpuMain", 4, 2), metadata("VizCompositorThread", 5, 1), metadata("Other", 6, 1),
      complete("RunTask", 0, 6000, 2, 1), complete("Task", 4000, 6000, 2, 1), ...pair("Nested", 1000, 2000, 2, 1),
      complete("Task", 0, 3000, 2, 2), ...pair("Task", 0, 4000, 3, 1), complete("Task", 0, 1000, 4, 1),
      complete("Task", 0, 2000, 4, 2), complete("Task", 0, 5000, 5, 1), complete("Task", 0, 25_000, 6, 1), ...pair("Wait", 0, 25_000, 3, 1, true)];
    expect(attributeWindow(events, window).threads).toEqual({ rasterMs: 13, compositorMs: 4, gpuMs: 3, vizMs: 5 });
    expect(attributeWindow(events, { start: 2000, end: 5000 }).threads).toEqual({ rasterMs: 4, compositorMs: 2, gpuMs: 0, vizMs: 3 });
    expect(attributeWindow(events.toReversed(), window)).toEqual(attributeWindow(events, window));
  });
});

describe("destination pipeline", () => {
  test("picks the last complete presenting chain and ignores an incomplete and a future chain", () => {
    const events = [metadata("Compositor", 2, 2), ...pipeline(0), ...pipeline(12_000), ...pipeline(23_000).filter((event) => event.name !== "Commit"), ...pipeline(26_000)];
    const result = attributeWindow(events, { start: 1000, end: 35_000 });
    expect(result.presentedMs).toBe(21);
    expect(result.pipeline.map((stage) => stage.step)).toEqual(stageOrder);
    expect(result.pipeline[0]).toEqual({ step: stageOrder[0], startMs: 11, endMs: 12, durationMs: 1 });
    expect(attributeWindow(events.toReversed(), { start: 1000, end: 35_000 })).toEqual(result);
  });

  test("async identities distinguish overlapping chains and browser-main/viz stages are accepted", () => {
    const events = [metadata("CrBrowserMain", 2, 2), metadata("VizCompositorThread", 2, 3), ...pipeline(0, "a", true), ...pipeline(2000, "b", true),
      ...pipeline(4000, "c", true).filter((event) => event.name !== "Commit"), ...pipeline(20_000, "viz", true, 3)];
    expect(attributeWindow(events, { start: 0, end: 14_000 }).presentedMs).toBe(12);
    expect(attributeWindow(events.toReversed(), { start: 0, end: 14_000 }).pipeline[0]?.startMs).toBe(2);
    expect(attributeWindow(events, window).presentedMs).toBe(30);
    expect(attributeWindow(events, window).threads).toEqual({ rasterMs: 0, compositorMs: 0, gpuMs: 0, vizMs: 0 });
  });

  test("retains full stages that begin before the window and rejects a chain submitted before it", () => {
    const events = [metadata("Compositor", 2, 2), ...pipeline(0)];
    expect(attributeWindow(events, { start: 500, end: 10_000 }).pipeline[0]).toEqual({ step: stageOrder[0], startMs: -0.5, endMs: 0.5, durationMs: 1 });
    expect(attributeWindow(events, { start: 500, end: 10_000 }).presentedMs).toBe(9.5);
    expect(attributeWindow(events, { start: 11_000, end: 20_000 }).pipeline).toEqual([]);
  });

  test("a chain submitted before the window cannot present the window's destination", () => {
    const events = [metadata("Compositor", 2, 2), ...pipeline(0)];
    const stale = attributeWindow(events, { start: 6000, end: 20_000 });
    expect(stale.pipeline).toEqual([]);
    expect(stale.presentedMs).toBeNull();
    const destination = attributeWindow([metadata("Compositor", 2, 2), ...pipeline(4000)], { start: 6000, end: 20_000 });
    expect(destination.presentedMs).toBe(8);
    expect(destination.pipeline.map((stage) => stage.step)).toEqual(stageOrder);
  });

  test("missing, wrong-category, wrong-thread, and incomplete chains cannot present", () => {
    for (const events of [[], [metadata("Other", 2, 2), ...pipeline(0)],
      [metadata("Compositor", 2, 2), ...pipeline(0).map((event) => ({ ...event, cat: "cc" }))],
      [metadata("Compositor", 2, 2), ...pipeline(0).filter((event) => event.ph !== "E")]]) {
      expect(attributeWindow(events, window).pipeline).toEqual([]);
      expect(attributeWindow(events, window).presentedMs).toBeNull();
    }
  });
});

describe("mark windows", () => {
  test("sorts interleaved marks, pairs FIFO by name and drops unmatched marks", () => {
    const marks = [{ name: "end", ts: 0 }, { name: "start", ts: 1000 }, { name: "other", ts: 1500 }, { name: "start", ts: 2000 },
      { name: "end", ts: 3000 }, { name: "end", ts: 4000 }, { name: "end", ts: 4500 }, { name: "start", ts: 5000 }];
    expect(markWindows(marks.toReversed(), "start", "end")).toEqual([{ start: 1000, end: 3000 }, { start: 2000, end: 4000 }]);
    expect(markWindows([], "start", "end")).toEqual([]);
    expect(markWindows([{ name: "start", ts: NaN }, { name: "end", ts: 10 }], "start", "end")).toEqual([]);
    expect(markWindows([{ name: "start", ts: 1 }, { name: "end", ts: 1 }], "start", "end")).toEqual([]);
    expect(() => markWindows([], "same", "same")).toThrow("Start and end mark names must differ");
  });
});

describe("long-animation-frame attribution", () => {
  const entry = (durationMs: number, blockingMs: number, invoker: string, scriptDuration: number, forced: number): LoafEntry => ({
    startMs: 0, durationMs, blockingMs, styleAndLayoutMs: 10,
    scripts: [{ invoker, invokerType: "event-listener", durationMs: scriptDuration, forcedStyleAndLayoutMs: forced }],
  });
  test("totals frames, blocking, maximum and forced style/layout, grouping invokers by duration", () => {
    const entries = [entry(60, 10, "click", 30, 3), entry(80, 25, "animation-frame", 40, 4), entry(70, 20, "click", 20, 2)];
    expect(summarizeLoaf(entries)).toEqual({ count: 3, totalMs: 210, blockingMs: 55, maxMs: 80, forcedStyleAndLayoutMs: 9, topInvoker: "click" });
    expect(summarizeLoaf(entries.toReversed())).toEqual(summarizeLoaf(entries));
    expect(summarizeLoaf([entry(60.123456, 1.123456, "b", 10, 0.123456), entry(0, 0, "a", 10, 0)])).toEqual({ count: 2, totalMs: 60.123, blockingMs: 1.123, maxMs: 60.123, forcedStyleAndLayoutMs: 0.123, topInvoker: "a" });
    expect(summarizeLoaf([])).toEqual({ count: 0, totalMs: 0, blockingMs: 0, maxMs: 0, forcedStyleAndLayoutMs: 0, topInvoker: null });
  });

  test("frames retain distinct invokers, total forced work and its share of each frame", () => {
    const first = entry(60, 10, "click", 30, 3);
    first.scripts.push({ invoker: "layout", invokerType: "event-listener", durationMs: 10, forcedStyleAndLayoutMs: 9 });
    expect(loafFrames([first, entry(80, 25, "animation-frame", 40, 4)])).toEqual([
      { startMs: 0, durationMs: 60, blockingMs: 10, styleAndLayoutMs: 10, forcedStyleAndLayoutMs: 12, forcedSharePct: 20, invoker: "click", invokerMs: 30 },
      { startMs: 0, durationMs: 80, blockingMs: 25, styleAndLayoutMs: 10, forcedStyleAndLayoutMs: 4, forcedSharePct: 5, invoker: "animation-frame", invokerMs: 40 },
    ]);
    expect(loafFrames([{ startMs: 10, durationMs: 50, blockingMs: 0, styleAndLayoutMs: 2, scripts: [] }])).toEqual([
      { startMs: 10, durationMs: 50, blockingMs: 0, styleAndLayoutMs: 2, forcedStyleAndLayoutMs: 0, forcedSharePct: 0, invoker: null, invokerMs: null },
    ]);
  });
  test("frame rounding uses three decimals and tied script durations select the smallest invoker", () => {
    const frame = entry(60.123456, 1.123456, "b", 10.123456, 0.123456);
    frame.startMs = 20.123456; frame.styleAndLayoutMs = 4.123456;
    frame.scripts.push({ invoker: "a", invokerType: "event-listener", durationMs: 10.123456, forcedStyleAndLayoutMs: 0.234567 });
    expect(loafFrames([frame])).toEqual([
      { startMs: 20.123, durationMs: 60.123, blockingMs: 1.123, styleAndLayoutMs: 4.123, forcedStyleAndLayoutMs: 0.358, forcedSharePct: 0.595, invoker: "a", invokerMs: 10.123 },
    ]);
    expect(loafFrames([{ ...frame, scripts: frame.scripts.toReversed() }])[0]?.invoker).toBe("a");
    expect(loafFrames([{ ...frame, durationMs: 0 }])[0]?.forcedSharePct).toBeNull();
    expect(loafFrames([])).toEqual([]);
  });

  type Collector = { supported: boolean; entries: LoafEntry[]; start(): void; stop(): void; drain(): number; reset(): void };
  type Frame = { startTime: number; duration: number; blockingDuration?: number; styleAndLayoutStart?: number; renderStart?: number;
    scripts?: { invoker: string; invokerType: string; duration: number; forcedStyleAndLayoutDuration: number }[] };
  function collectorHarness() {
    let emit: ((frames: Frame[]) => void) | undefined;
    let queued: Frame[] = [], observes = 0, disconnects = 0;
    class Observer {
      static supportedEntryTypes = ["long-animation-frame"];
      constructor(callback: (list: { getEntries(): Frame[] }) => void) { emit = (frames) => callback({ getEntries: () => frames }); }
      observe(options: { type: string }) { expect(options).toEqual({ type: "long-animation-frame" }); observes++; }
      disconnect() { disconnects++; }
      takeRecords() { const records = queued; queued = []; return records; }
    }
    const context: { PerformanceObserver: typeof Observer; __homeNavigationLoaf?: Collector } = { PerformanceObserver: Observer };
    runInNewContext(loafCollectorSource, context);
    const api = context.__homeNavigationLoaf;
    if (!api) throw new Error("Collector global missing");
    return { api, emit: (frames: Frame[]) => emit?.(frames), queue: (frames: Frame[]) => { queued = frames; }, counts: () => ({ observes, disconnects }), context };
  }

  test("collector normalizes entries and start/stop/reset manage pending records without replaying history", () => {
    const harness = collectorHarness();
    expect(harness.api.supported).toBe(true);
    harness.api.start();
    expect(harness.counts().observes).toBe(1);
    harness.emit([{ startTime: 100, duration: 60, blockingDuration: 10, renderStart: 140, styleAndLayoutStart: 150,
      scripts: [{ invoker: "click", invokerType: "event-listener", duration: 30, forcedStyleAndLayoutDuration: 4 }] }]);
    expect(harness.api.entries).toEqual([{ startMs: 100, durationMs: 60, blockingMs: 10, styleAndLayoutMs: 10,
      scripts: [{ invoker: "click", invokerType: "event-listener", durationMs: 30, forcedStyleAndLayoutMs: 4 }] }]);
    harness.queue([{ startTime: 200, duration: 70 }]);
    harness.api.stop();
    harness.api.stop();
    expect(harness.api.entries[1]).toEqual({ startMs: 200, durationMs: 70, blockingMs: 0, styleAndLayoutMs: 0, scripts: [] });
    expect(harness.counts().disconnects).toBe(1);
    harness.api.start();
    harness.queue([{ startTime: 300, duration: 80 }]);
    const entries = harness.api.entries;
    harness.api.reset();
    expect(harness.api.entries).toBe(entries);
    harness.api.stop();
    expect(entries).toEqual([]);
    runInNewContext(loafCollectorSource, harness.context);
    expect(harness.counts().observes).toBe(3);
  });

  test("drain flushes queued records without disconnecting", () => {
    const harness = collectorHarness();
    harness.api.start();
    harness.queue([{ startTime: 100, duration: 60 }]);
    expect(harness.api.drain()).toBe(1);
    expect(harness.api.entries).toHaveLength(1);
    harness.queue([{ startTime: 200, duration: 70 }]);
    expect(harness.api.drain()).toBe(2);
    expect(harness.counts().disconnects).toBe(0);
    harness.api.stop();
    expect(harness.counts().disconnects).toBe(1);
  });
  test("collector exposes unsupported browsers and observation failures without throwing", () => {
    for (const PerformanceObserver of [undefined, class { static supportedEntryTypes = []; }, class {
      static supportedEntryTypes = ["long-animation-frame"];
      observe() { throw new Error("Unsupported"); }
      disconnect() {}
    }]) {
      const context: { PerformanceObserver: typeof PerformanceObserver; __homeNavigationLoaf?: Collector } = { PerformanceObserver };
      expect(() => { runInNewContext(loafCollectorSource, context); }).not.toThrow();
      expect(context.__homeNavigationLoaf?.supported).toBe(false);
      expect(() => { context.__homeNavigationLoaf?.start(); context.__homeNavigationLoaf?.stop(); context.__homeNavigationLoaf?.reset(); }).not.toThrow();
      expect(context.__homeNavigationLoaf?.entries).toEqual([]);
    }
  });
});
