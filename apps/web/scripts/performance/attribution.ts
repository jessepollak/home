export type TraceEvent = {
  name?: string; cat?: string; ph?: string; ts?: number; dur?: number; pid?: number; tid?: number;
  args?: { name?: string; type?: string; functionName?: string };
  id?: string | number; id2?: { local?: string }; scope?: string;
};

/** Half-open trace window in microseconds. */
export type AttributionWindow = { start: number; end: number };
export type MainThreadBreakdown = {
  busyMs: number; scriptMs: number; forcedStyleMs: number; forcedLayoutMs: number;
  lifecycleStyleMs: number; lifecycleLayoutMs: number; paintMs: number; otherMs: number;
};
export type ThreadBusy = { rasterMs: number; compositorMs: number; gpuMs: number; vizMs: number };
export type PipelineStage = { step: string; startMs: number; endMs: number; durationMs: number };
export type WindowAttribution = {
  windowMs: number; main: MainThreadBreakdown; threads: ThreadBusy;
  pipeline: PipelineStage[]; presentedMs: number | null;
};
export type LoafScript = { invoker: string; invokerType: string; durationMs: number; forcedStyleAndLayoutMs: number };
export type LoafEntry = { startMs: number; durationMs: number; blockingMs: number; styleAndLayoutMs: number; scripts: LoafScript[] };
export type LoafFrame = {
  startMs: number; durationMs: number; blockingMs: number; styleAndLayoutMs: number; forcedStyleAndLayoutMs: number;
  forcedSharePct: number | null; invoker: string | null; invokerMs: number | null;
};
export type LoafSummary = {
  count: number; totalMs: number; blockingMs: number; maxMs: number;
  forcedStyleAndLayoutMs: number; topInvoker: string | null;
};

type Interval = {
  name: string; category: string; start: number; end: number; pid: number; tid: number;
  async: boolean; identity: string;
};
type Bucket = Exclude<keyof MainThreadBreakdown, "busyMs">;
const scripts = new Set(["EventDispatch", "FunctionCall", "EvaluateScript", "FireAnimationFrame", "TimerFire", "FireIdleCallback", "v8.run", "RunMicrotasks"]);
const layouts = new Set(["Layout", "LocalFrameView::layout", "LocalFrameView::performLayout"]);
const styles = new Set(["UpdateLayoutTree", "AnimationFrame::StyleAndLayout", "LocalFrameView::RunStyleAndLayoutLifecyclePhases"]);
const paints = new Set(["Paint", "PrePaint", "LocalFrameView::RunPaintLifecyclePhase"]);
const steps = [
  "BeginImplFrameToSendBeginMainFrame", "SendBeginMainFrameToCommit", "Commit", "EndCommitToActivation",
  "EndActivateToSubmitCompositorFrame", "SubmitCompositorFrameToPresentationCompositorFrame", "SubmitToReceiveCompositorFrame",
  "ReceiveCompositorFrameToStartDraw", "StartDrawToSwapStart", "SwapEndToPresentationCompositorFrame", "LatchToSwapEnd",
];
const round = (value: number) => Math.round(value * 1000) / 1000;
const ms = (microseconds: number) => round(microseconds / 1000);
const textOrder = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const finite = (value: number | undefined): value is number => typeof value === "number" && Number.isFinite(value);
const threadKey = (pid: number, tid: number) => `${pid}:${tid}`;
const zeroMain = (): MainThreadBreakdown => ({ busyMs: 0, scriptMs: 0, forcedStyleMs: 0, forcedLayoutMs: 0, lifecycleStyleMs: 0, lifecycleLayoutMs: 0, paintMs: 0, otherMs: 0 });

function threadNames(events: TraceEvent[]) {
  const names = new Map<string, string>();
  for (const event of [...events].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0) || textOrder(a.args?.name ?? "", b.args?.name ?? ""))) {
    if (event.ph === "M" && event.name === "thread_name" && finite(event.pid) && finite(event.tid) && event.args?.name)
      names.set(threadKey(event.pid, event.tid), event.args.name);
  }
  return names;
}

/** With multiple renderers, chooses the lowest pid/tid; callers should pass their page's trace. */
export function mainThread(events: TraceEvent[]): { pid: number; tid: number } | null {
  const candidates = [...threadNames(events)].filter(([, name]) => name === "CrRendererMain")
    .map(([key]) => { const [pid = 0, tid = 0] = key.split(":").map(Number); return { pid, tid }; })
    .sort((a, b) => a.pid - b.pid || a.tid - b.tid);
  return candidates[0] ?? null;
}

function eventIdentity(event: TraceEvent) {
  return JSON.stringify([event.pid, event.tid, event.scope ?? "", event.id2?.local ?? event.id ?? null]);
}

// Unmatched pairs are dropped. Sync pairs use name/thread LIFO; async pairs also honor scope and identity.
function intervals(events: TraceEvent[]): Interval[] {
  const result: Interval[] = [];
  const stacks = new Map<string, TraceEvent[]>();
  const phaseOrder = (ph: string | undefined) => ph === "E" || ph === "e" ? 0 : 1;
  const sorted = events.filter((event) => finite(event.ts)).sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0)
    || phaseOrder(a.ph) - phaseOrder(b.ph) || textOrder(eventIdentity(a), eventIdentity(b))
    || textOrder(a.name ?? "", b.name ?? "") || textOrder(a.cat ?? "", b.cat ?? "") || (b.dur ?? 0) - (a.dur ?? 0));
  for (const event of sorted) {
    if (!finite(event.ts) || !finite(event.pid) || !finite(event.tid) || !event.name) continue;
    const async = event.ph === "b" || event.ph === "e";
    const identity = eventIdentity(event);
    if (event.ph === "X" && finite(event.dur) && event.dur > 0 && finite(event.ts + event.dur)) {
      result.push({ name: event.name, category: event.cat ?? "", start: event.ts, end: event.ts + event.dur, pid: event.pid, tid: event.tid, async: false, identity });
    } else if (["B", "E", "b", "e"].includes(event.ph ?? "")) {
      const key = JSON.stringify([async ? identity : threadKey(event.pid, event.tid), event.name, async ? event.cat ?? "" : "", async]);
      const stack = stacks.get(key) ?? [];
      if (event.ph === "B" || event.ph === "b") {
        stack.push(event);
        stacks.set(key, stack);
      } else {
        const begin = stack.pop();
        if (begin && finite(begin.ts) && begin.ts < event.ts)
          result.push({ name: event.name, category: begin.cat ?? "", start: begin.ts, end: event.ts, pid: event.pid, tid: event.tid, async, identity });
      }
    }
  }
  return result.sort((a, b) => a.start - b.start || a.end - b.end || textOrder(a.identity, b.identity) || textOrder(a.name, b.name));
}

function unionTime(items: Interval[], window: AttributionWindow) {
  let total = 0, until = window.start;
  for (const item of items) {
    const start = Math.max(item.start, window.start, until), end = Math.min(item.end, window.end);
    if (end > start) total += end - start;
    until = Math.max(until, end);
  }
  return total;
}

function mainBreakdown(items: Interval[], window: AttributionWindow): MainThreadBreakdown {
  const total = zeroMain();
  const scriptIntervals = items.filter((item) => !item.async && scripts.has(item.name));
  const bucketFor = (item: Interval): Bucket | null => {
    if (scripts.has(item.name)) return item.async ? null : "scriptMs";
    if (paints.has(item.name)) return item.async ? null : "paintMs";
    if (!layouts.has(item.name) && !styles.has(item.name)) return null;
    const forced = scriptIntervals.some((script) => script.start <= item.start && script.end >= item.end);
    // Combined-wrapper self time is style; explicit nested layout or paint owns its own self time.
    return layouts.has(item.name) ? forced ? "forcedLayoutMs" : "lifecycleLayoutMs" : forced ? "forcedStyleMs" : "lifecycleStyleMs";
  };
  const edges: { at: number; item: Interval; bucket: Bucket | null; enter: boolean }[] = [];
  for (const item of items) {
    const start = Math.max(item.start, window.start), end = Math.min(item.end, window.end), bucket = bucketFor(item);
    if (end <= start || (item.async && bucket === null)) continue;
    edges.push({ at: start, item, bucket, enter: true }, { at: end, item, bucket, enter: false });
  }
  edges.sort((a, b) => a.at - b.at);
  const active = new Map<Interval, Bucket | null>();
  let previous = window.start, synchronous = 0;
  const rank = (bucket: Bucket) => bucket === "paintMs" ? 4 : bucket.includes("Layout") ? 3 : bucket.includes("Style") ? 2 : 1;
  for (const edge of edges) {
    const duration = edge.at - previous;
    // Async labels can reattribute synchronous work, never establish busy time or count idle waits.
    if (duration > 0 && synchronous > 0) {
      total.busyMs += duration;
      let selected: { item: Interval; bucket: Bucket } | null = null;
      for (const [item, bucket] of active) {
        if (bucket === null) continue;
        const length = item.end - item.start, selectedLength = selected ? selected.item.end - selected.item.start : Infinity;
        if (length < selectedLength || (length === selectedLength && selected && rank(bucket) > rank(selected.bucket))) selected = { item, bucket };
      }
      total[selected?.bucket ?? "otherMs"] += duration;
    }
    if (edge.enter) active.set(edge.item, edge.bucket);
    else active.delete(edge.item);
    if (!edge.item.async) synchronous += edge.enter ? 1 : -1;
    previous = edge.at;
  }
  for (const key of Object.keys(total) as (keyof MainThreadBreakdown)[]) total[key] = ms(total[key]);
  return total;
}

function destinationPipeline(items: Interval[], names: Map<string, string>, window: AttributionWindow) {
  const groups = new Map<string, Interval[]>();
  for (const item of items) {
    const categories = item.category.split(","), thread = names.get(threadKey(item.pid, item.tid));
    if (!steps.includes(item.name) || !categories.includes("benchmark") || (!categories.includes("cc") && !categories.includes("viz"))
      || !["Compositor", "VizCompositorThread", "CrBrowserMain"].includes(thread ?? "")) continue;
    const group = groups.get(item.identity) ?? [];
    group.push(item);
    groups.set(item.identity, group);
  }
  let selected: Interval[] = [], presentation = -Infinity;
  for (const group of groups.values()) {
    const beginnings = group.filter((item) => item.name === steps[0]);
    for (const [index, first] of beginnings.entries()) {
      const nextBeginning = beginnings[index + 1]?.start ?? Infinity;
      const chain = new Map<string, Interval>([[first.name, first]]);
      let cursor = first.end;
      for (const step of steps.slice(1, 6)) {
        const item = group.find((candidate) => candidate.name === step && candidate.start >= cursor && candidate.start < nextBeginning);
        if (!item) break;
        chain.set(step, item);
        cursor = item.end;
      }
      const submission = chain.get("SubmitCompositorFrameToPresentationCompositorFrame");
      // A frame submitted before the start mark presents the previous navigation, not the destination.
      if (!submission || submission.start < window.start || submission.end > window.end) continue;
      cursor = submission.start;
      for (const step of ["SubmitToReceiveCompositorFrame", "ReceiveCompositorFrameToStartDraw", "StartDrawToSwapStart", "LatchToSwapEnd", "SwapEndToPresentationCompositorFrame"]) {
        const item = group.find((candidate) => candidate.name === step && candidate.start >= cursor && candidate.end <= submission.end);
        if (!item) break;
        chain.set(step, item);
        cursor = item.end;
      }
      const swap = chain.get("SwapEndToPresentationCompositorFrame");
      if (chain.size !== steps.length || !swap || swap.end !== submission.end || swap.end <= presentation) continue;
      selected = steps.flatMap((step) => { const item = chain.get(step); return item ? [item] : []; });
      presentation = swap.end;
    }
  }
  // Pipeline spans retain the full chain, including negative offsets for stages before the start mark.
  // Selection above requires the submission itself to start inside the window.
  return { pipeline: selected.map((item) => ({ step: item.name, startMs: ms(item.start - window.start), endMs: ms(item.end - window.start), durationMs: ms(item.end - item.start) })),
    presentedMs: selected.length ? ms(presentation - window.start) : null };
}

export function attributeWindow(events: TraceEvent[], window: AttributionWindow): WindowAttribution {
  const result: WindowAttribution = { windowMs: 0, main: zeroMain(), threads: { rasterMs: 0, compositorMs: 0, gpuMs: 0, vizMs: 0 }, pipeline: [], presentedMs: null };
  if (!finite(window.start) || !finite(window.end) || window.end <= window.start) return result;
  result.windowMs = ms(window.end - window.start);
  const items = intervals(events), names = threadNames(events), main = mainThread(events);
  if (main) result.main = mainBreakdown(items.filter((item) => item.pid === main.pid && item.tid === main.tid), window);
  const byThread = new Map<string, Interval[]>();
  for (const item of items) {
    if (item.async) continue;
    const key = threadKey(item.pid, item.tid), group = byThread.get(key) ?? [];
    group.push(item);
    byThread.set(key, group);
  }
  for (const [key, group] of byThread) {
    const name = names.get(key) ?? "";
    const bucket: keyof ThreadBusy | null = name.startsWith("CompositorTileWorker") ? "rasterMs" : name === "Compositor" ? "compositorMs"
      : name === "CrGpuMain" || name === "GpuMain" ? "gpuMs" : name === "VizCompositorThread" ? "vizMs" : null;
    if (bucket) result.threads[bucket] += unionTime(group, window);
  }
  for (const key of Object.keys(result.threads) as (keyof ThreadBusy)[]) result.threads[key] = ms(result.threads[key]);
  return { ...result, ...destinationPipeline(items, names, window) };
}

/** FIFO pairing; unrelated, non-finite, unmatched and non-positive windows are dropped. */
export function markWindows(marks: { name: string; ts: number }[], start: string, end: string): AttributionWindow[] {
  if (start === end) throw new Error("Start and end mark names must differ");
  const pending: number[] = [], windows: AttributionWindow[] = [];
  for (const mark of [...marks].filter((mark) => finite(mark.ts)).sort((a, b) => a.ts - b.ts || textOrder(a.name, b.name))) {
    if (mark.name === start) pending.push(mark.ts);
    else if (mark.name === end) {
      const begin = pending.shift();
      if (begin !== undefined && mark.ts > begin) windows.push({ start: begin, end: mark.ts });
    }
  }
  return windows;
}

export function loafFrames(entries: LoafEntry[]): LoafFrame[] {
  return entries.map((entry) => {
    const forcedMs = entry.scripts.reduce((total, script) => total + script.forcedStyleAndLayoutMs, 0);
    const top = [...entry.scripts].sort((a, b) => b.durationMs - a.durationMs || textOrder(a.invoker, b.invoker))[0];
    return { startMs: round(entry.startMs), durationMs: round(entry.durationMs), blockingMs: round(entry.blockingMs),
      styleAndLayoutMs: round(entry.styleAndLayoutMs), forcedStyleAndLayoutMs: round(forcedMs),
      forcedSharePct: entry.durationMs === 0 ? null : round(100 * forcedMs / entry.durationMs),
      invoker: top?.invoker ?? null, invokerMs: top ? round(top.durationMs) : null };
  });
}

export function summarizeLoaf(entries: LoafEntry[]): LoafSummary {
  const summary: LoafSummary = { count: entries.length, totalMs: 0, blockingMs: 0, maxMs: 0, forcedStyleAndLayoutMs: 0, topInvoker: null };
  const invokers = new Map<string, number>();
  for (const entry of entries) {
    summary.totalMs += entry.durationMs;
    summary.blockingMs += entry.blockingMs;
    summary.maxMs = Math.max(summary.maxMs, entry.durationMs);
    for (const script of entry.scripts) {
      summary.forcedStyleAndLayoutMs += script.forcedStyleAndLayoutMs;
      invokers.set(script.invoker, (invokers.get(script.invoker) ?? 0) + script.durationMs);
    }
  }
  summary.topInvoker = [...invokers].sort(([a, aMs], [b, bMs]) => bMs - aMs || textOrder(a, b))[0]?.[0] ?? null;
  summary.totalMs = round(summary.totalMs);
  summary.blockingMs = round(summary.blockingMs);
  summary.maxMs = round(summary.maxMs);
  summary.forcedStyleAndLayoutMs = round(summary.forcedStyleAndLayoutMs);
  return summary;
}

/** Installs globalThis.__homeNavigationLoaf: { supported, entries, start(), stop(), drain(), reset() }; starts immediately. */
export const loafCollectorSource: string = `(() => {
  const key = "__homeNavigationLoaf";
  globalThis[key]?.stop();
  const entries = [];
  let observer = null;
  const collect = (frames) => {
    for (const frame of frames) entries.push({
      startMs: frame.startTime, durationMs: frame.duration, blockingMs: frame.blockingDuration ?? 0,
      styleAndLayoutMs: frame.styleAndLayoutStart > 0 ? Math.max(0, frame.startTime + frame.duration - frame.styleAndLayoutStart) : 0,
      scripts: Array.from(frame.scripts ?? [], (script) => ({
        invoker: script.invoker ?? "", invokerType: script.invokerType ?? "",
        durationMs: script.duration, forcedStyleAndLayoutMs: script.forcedStyleAndLayoutDuration ?? 0
      }))
    });
  };
  const api = {
    supported: typeof PerformanceObserver !== "undefined" && (PerformanceObserver.supportedEntryTypes ?? []).includes("long-animation-frame"),
    entries,
    start() {
      if (!api.supported || observer) return;
      try {
        observer = new PerformanceObserver((list) => collect(list.getEntries()));
        observer.observe({ type: "long-animation-frame" });
      } catch {
        observer?.disconnect();
        observer = null;
        api.supported = false;
      }
    },
    stop() {
      if (!observer) return;
      collect(observer.takeRecords());
      observer.disconnect();
      observer = null;
    },
    drain() {
      if (observer) collect(observer.takeRecords());
      return entries.length;
    },
    reset() {
      observer?.takeRecords();
      entries.length = 0;
    }
  };
  globalThis[key] = api;
  api.start();
})()`;
