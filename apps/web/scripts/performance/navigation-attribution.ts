import { type Browser, type Page } from "@playwright/test";
import { installApiFixtures, seedSignedInSession } from "../../tests/browser/fixtures/api";
import { attributeWindow, loafCollectorSource, loafFrames, mainThread, markWindows, summarizeLoaf,
  type LoafEntry, type LoafFrame, type LoafSummary, type TraceEvent, type WindowAttribution } from "./attribution";
import { inlineFixtureMark, twoFrames, type CpuRate, type Session } from "./browser";
import { navigationCycles, navigationSettleMs, navigationTraceCategories } from "./config";
import { median, percentile } from "./evaluate";
import { closeDetailRow, fillFeed, installFeed, openDetailRow, scrollFeedTo, selectDetailRow } from "./feed";
import { browserBack, home, navigate, ready, warmNavigation } from "./navigation";
import { aggregateReact, reactAvailability, reactCommitCollectorSource, summarizeReactWindow, type ReactAttributionReport, type ReactCommitCollector, type ReactWindowSummary } from "./react-attribution";

export type NavigationLeg = "outbound" | "home" | "back" | "detail";
export type NavigationWindow = {
  path: string; leg: NavigationLeg; cycle: number; latencyMs: number;
  startMark: string; endMark: string; startMs: number; endMs: number;
};
export type NavigationAttributionSample = Pick<NavigationWindow, "path" | "leg" | "cycle" | "latencyMs"> & {
  windowMs: number; main: WindowAttribution["main"] | null;
  threads: { [K in keyof WindowAttribution["threads"]]: number | null };
  pipeline: WindowAttribution["pipeline"]; presentedMs: number | null; loaf: LoafSummary | null;
  loafFrames: LoafFrame[] | null;
  react: ReactWindowSummary | null; reactReason: string | null;
};
export type WebKitSample = Pick<NavigationWindow, "path" | "leg" | "cycle" | "latencyMs"> & {
  frameGaps: number[]; frameGapP95Ms: number | null; frameGapMaxMs: number | null; longFrameCount: number;
};
export type WebKitResult = { browser: string | null; samples: WebKitSample[]; errors: { path: string | null; reason: string }[] };
export type NavigationAttributionReport = {
  rows: number; pooling: "cycles and measured legs per path"; chromium: ReturnType<typeof aggregateAttribution>[];
  samples: NavigationAttributionSample[]; plainLatenciesByPath: Record<string, number[]>;
  webkit: WebKitResult & { paths: ReturnType<typeof aggregateWebKit>[] };
  react: ReactAttributionReport | null;
};

export function latencySummary(values: number[]) {
  return { samples: values.length, p50: values.length ? median(values) : null, p95: values.length ? percentile(values, 0.95) : null };
}

export function overheadDelta(plain: number[], instrumented: number[]) {
  const baseline = latencySummary(plain), attribution = latencySummary(instrumented);
  return { plain: baseline, attribution,
    p50DeltaMs: baseline.p50 === null || attribution.p50 === null ? null : attribution.p50 - baseline.p50,
    p95DeltaMs: baseline.p95 === null || attribution.p95 === null ? null : attribution.p95 - baseline.p95 };
}

export function sliceLoaf(entries: LoafEntry[], window: { startMs: number; endMs: number }) {
  return entries.filter((entry) => entry.durationMs >= 50 && entry.startMs >= window.startMs && entry.startMs < window.endMs);
}

export function topInvokerByPath(entries: LoafEntry[], windows: readonly { path: string; startMs: number; endMs: number }[]): Record<string, string | null> {
  const selected = new Map<string, LoafEntry[]>();
  for (const window of windows) selected.set(window.path, [...(selected.get(window.path) ?? []), ...sliceLoaf(entries, window)]);
  return Object.fromEntries([...selected].map(([path, slices]) => [path, summarizeLoaf(slices).topInvoker]));
}

export function summarizeLoafWindow(collector: { supported: boolean; entries: LoafEntry[] }, window: { startMs: number; endMs: number }) {
  if (!collector.supported) return { loaf: null, loafFrames: null };
  const entries = sliceLoaf(collector.entries, window);
  return { loaf: summarizeLoaf(entries),
    loafFrames: loafFrames(entries.map((entry) => ({ ...entry, startMs: entry.startMs - window.startMs }))) };
}

export function mapTraceWindows(events: TraceEvent[], windows: NavigationWindow[], cycles: number, dataLossOccurred = false,
  legs: readonly NavigationLeg[] = ["outbound", "home"]) {
  if (dataLossOccurred) throw new Error("Navigation attribution trace reported data loss; refusing incomplete buckets");
  if (windows.length !== cycles * legs.length) throw new Error(`Navigation attribution window/leg mismatch: expected ${cycles * legs.length}, got ${windows.length}`);
  const names = new Set<string>(), paths = new Map<NavigationLeg, string>();
  const marks = events.filter((event) => event.cat?.split(",").includes("blink.user_timing"));
  let previousTraceEnd = -Infinity, previousPageEnd = -Infinity;
  return windows.map((window, index) => {
    if (window.cycle !== Math.floor(index / legs.length) + 1 || window.leg !== legs[index % legs.length]
      || (paths.has(window.leg) && window.path !== paths.get(window.leg))) throw new Error(`Navigation attribution missing or out-of-order leg at ${index}`);
    paths.set(window.leg, window.path);
    if (!Number.isFinite(window.startMs) || !Number.isFinite(window.endMs) || window.endMs <= window.startMs || window.startMs < previousPageEnd)
      throw new Error(`Navigation attribution invalid page-clock window at ${index}`);
    if (names.has(window.startMark) || names.has(window.endMark) || window.startMark === window.endMark)
      throw new Error("Navigation attribution mark names must be distinct");
    names.add(window.startMark); names.add(window.endMark);
    const pairedMarks = marks.filter((event) => event.name === window.startMark || event.name === window.endMark);
    const matched = markWindows(pairedMarks.flatMap((event) => typeof event.ts === "number" ? [{ name: event.name!, ts: event.ts }] : []), window.startMark, window.endMark);
    const traceWindow = matched[0];
    if (pairedMarks.length !== 2 || matched.length !== 1 || !traceWindow || traceWindow.start < previousTraceEnd)
      throw new Error(`Navigation attribution unmatched or out-of-order trace marks for ${window.path} cycle ${window.cycle} ${window.leg}`);
    previousTraceEnd = traceWindow.end; previousPageEnd = window.endMs;
    return { ...window, traceWindow };
  });
}

export function aggregateAttribution(path: string, samples: NavigationAttributionSample[], plain: number[], topInvoker: string | null = null) {
  const selected = samples.filter((sample) => sample.path === path);
  const p50 = (values: number[]) => values.length ? median(values) : null;
  const mainKeys = ["busyMs", "scriptMs", "forcedStyleMs", "forcedLayoutMs", "lifecycleStyleMs", "lifecycleLayoutMs", "paintMs", "otherMs"] as const;
  const threadKeys = ["rasterMs", "compositorMs", "gpuMs", "vizMs"] as const;
  const main = Object.fromEntries(mainKeys.map((key) => [key, p50(selected.flatMap((sample) => sample.main ? [sample.main[key]] : []))]));
  const threads = Object.fromEntries(threadKeys.map((key) => [key, p50(selected.flatMap((sample) => sample.threads[key] === null ? [] : [sample.threads[key]]))]));
  const stages = [...new Set(selected.flatMap((sample) => sample.pipeline.map((stage) => stage.step)))];
  const pipeline = stages.map((step) => {
    const durations = selected.flatMap((sample) => sample.pipeline.filter((stage) => stage.step === step).map((stage) => stage.durationMs));
    return { step, samples: durations.length, durationMs: p50(durations) };
  });
  const supported = selected.filter((sample) => sample.loaf !== null);
  const loaf = supported.length ? {
    samples: supported.length, count: 0, totalMs: 0, blockingMs: 0, maxMs: 0, forcedStyleAndLayoutMs: 0, topInvoker,
    forcedSharePct: null as number | null,
  } : null;
  if (loaf) {
    for (const sample of supported) {
      const frame = sample.loaf!;
      loaf.count += frame.count; loaf.totalMs += frame.totalMs; loaf.blockingMs += frame.blockingMs;
      loaf.maxMs = Math.max(loaf.maxMs, frame.maxMs); loaf.forcedStyleAndLayoutMs += frame.forcedStyleAndLayoutMs;
    }
    loaf.forcedSharePct = loaf.totalMs ? 100 * loaf.forcedStyleAndLayoutMs / loaf.totalMs : null;
  }
  const frames: (LoafFrame & { leg: NavigationLeg; cycle: number })[] = selected.flatMap((sample) =>
    (sample.loafFrames ?? []).map((frame) => ({ ...frame, leg: sample.leg, cycle: sample.cycle })));
  return { path, latency: latencySummary(selected.map((sample) => sample.latencyMs)), windowMs: p50(selected.map((sample) => sample.windowMs)),
    presented: latencySummary(selected.flatMap((sample) => sample.presentedMs === null ? [] : [sample.presentedMs])),
    main, threads, pipeline, loaf, frames, overhead: overheadDelta(plain, selected.map((sample) => sample.latencyMs)) };
}

export function aggregateWebKit(path: string, samples: WebKitSample[]) {
  const selected = samples.filter((sample) => sample.path === path), gaps = selected.flatMap((sample) => sample.frameGaps);
  return { path, latency: latencySummary(selected.map((sample) => sample.latencyMs)), frames: gaps.length,
    frameGapP95Ms: gaps.length ? percentile(gaps, 0.95) : null, frameGapMaxMs: gaps.length ? Math.max(...gaps) : null,
    longFrameCount: gaps.length ? gaps.filter((gap) => gap > 50).length : null };
}

type AttributionWindowGlobals = { __homeAttributionPerf?: Performance; __homeNativeRaf?: (callback: FrameRequestCallback) => number; __homeNavigationLoaf?: LoafCollector; __homeFrameGaps?: { stop: () => number[] }; __homeReactCommits?: ReactCommitCollector };

// The navigation gates install Playwright's clock, which replaces window.performance with a fake
// whose mark() is a no-op and requestAnimationFrame with a synthetic cadence. Window marks must
// reach the trace and the tail drain must wait on a real frame, so capture both native objects first.
async function captureRealPerformance(page: Page) {
  await page.addInitScript(() => {
    const w = window as typeof window & AttributionWindowGlobals;
    w.__homeAttributionPerf = performance;
    w.__homeNativeRaf = requestAnimationFrame.bind(window);
  });
}

async function mark(page: Page, name: string) {
  return page.evaluate((markName) => {
    const perf = (window as typeof window & AttributionWindowGlobals).__homeAttributionPerf;
    if (!perf) throw new Error("The real performance object was not captured before the clock install");
    perf.mark(markName);
    return perf.now();
  }, name);
}

type LoafCollector = { supported: boolean; entries: LoafEntry[]; stop: () => void; drain: () => number };

const realTimers = {
  set: (callback: () => void, ms: number): unknown => setTimeout(callback, ms),
  clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

// Long-animation-frame entries are reported only after their frame's rendering update, which can
// trail the final mark by more than a frame. Drain the observer on each native frame until the
// entry count holds steady, bounded by a deadline so a stalled renderer cannot hang the phase.
export async function drainTailFrames(evaluate: () => Promise<number>, timeoutMs = 2_000, timers: {
  set: (callback: () => void, ms: number) => unknown; clear: (handle: unknown) => void;
} = realTimers, quietFrames = 3): Promise<void> {
  let timer: unknown;
  const deadline = new Promise<"expired">((resolve) => { timer = timers.set(() => resolve("expired"), timeoutMs); });
  let stable = 0, previous = -1;
  try {
    while (stable < quietFrames) {
      const next = await Promise.race([evaluate().then((count) => ({ count }), () => ({ count: -1 })), deadline]);
      if (next === "expired") return;
      stable = next.count === previous ? stable + 1 : 0;
      previous = next.count;
    }
  } finally { timers.clear(timer); }
}

export async function endTraceWithDeadline(send: () => Promise<unknown>, timeoutMs = 5000, timers: {
  set: (callback: () => void, ms: number) => unknown; clear: (handle: unknown) => void;
} = realTimers): Promise<void> {
  let timer: unknown;
  const deadline = new Promise<void>((resolve) => { timer = timers.set(resolve, timeoutMs); });
  try {
    await Promise.race([Promise.resolve().then(send).then(() => {}, () => {}), deadline]);
  } finally { timers.clear(timer); }
}

export async function awaitTraceEnd(ending: Promise<unknown>, completed: Promise<{ dataLossOccurred?: boolean }>,
  timeoutMs = 20_000, timers = realTimers): Promise<{ dataLossOccurred?: boolean }> {
  let timer: unknown;
  // The deadline covers both the stop acknowledgement and the completion event.
  const deadline = new Promise<never>((_, fail) => {
    timer = timers.set(() => fail(new Error("Navigation attribution trace did not finish within 20 s")), timeoutMs);
  });
  try {
    const [, completion] = await Promise.race([Promise.all([ending, completed]), deadline]);
    return completion;
  } finally { timers.clear(timer); }
}

export async function runChromiumNavigationAttribution(session: Session, baseUrl: string, rows: number, path: string, options: { collectCommits?: boolean } = {}) {
  const { page } = session;
  if (options.collectCommits) await page.addInitScript(reactCommitCollectorSource);
  await captureRealPerformance(page);
  await page.clock.install({ time: new Date() });
  await inlineFixtureMark(page);
  const fixture = await installFeed(page, rows);
  await page.goto(`${baseUrl}/home`, { waitUntil: "domcontentloaded" });
  await ready(page, "/home");
  await fillFeed(session, rows, fixture.filled, "section[data-activity-feed]");
  fixture.verify();
  await page.evaluate<void, "top" | "bottom">(scrollFeedTo, "top");
  await twoFrames(page);
  await warmNavigation(page, [path]);
  return collectChromiumAttribution(session, {
    legs: ["outbound", "home"], path: () => path,
    measure: (leg) => leg === "outbound" ? navigate(page, path) : home(page),
  }, options);
}

type AttributionScenario = {
  legs: readonly NavigationLeg[]; path: (leg: NavigationLeg) => string;
  before?: (leg: NavigationLeg) => Promise<unknown>;
  measure: (leg: NavigationLeg, cycle: number) => Promise<number>;
  after?: () => Promise<unknown>;
};

async function collectChromiumAttribution(session: Session, scenario: AttributionScenario, options: { collectCommits?: boolean }) {
  const { page, cdp } = session;
  await page.evaluate(loafCollectorSource);
  const events: TraceEvent[] = [], windows: NavigationWindow[] = [], cpu: CpuRate[] = [];
  const collect = (data: { value: TraceEvent[] }) => { for (const event of data.value) events.push(event); };
  let traceRunning = false;
  cdp.on("Tracing.dataCollected", collect);
  try {
    await cdp.send("Tracing.start", { transferMode: "ReportEvents", categories: navigationTraceCategories });
    traceRunning = true;
    const started = Date.now();
    for (let cycle = 1; cycle <= navigationCycles; cycle++) for (const leg of scenario.legs) {
      await scenario.before?.(leg);
      const startMark = `home-attribution-${cycle}-${leg}-start`, endMark = `home-attribution-${cycle}-${leg}-end`;
      const startMs = await mark(page, startMark);
      const latencyMs = await scenario.measure(leg, cycle);
      const endMs = await mark(page, endMark);
      windows.push({ path: scenario.path(leg), leg, cycle, latencyMs, startMark, endMark, startMs, endMs });
      cpu.push({ ...session.cpu });
      await scenario.after?.();
    }
    if (Date.now() - started >= 55_000) throw new Error("Navigation attribution windows crossed the 60 s savings poll interval");
    await drainTailFrames(() => page.evaluate(() => new Promise<number>((resolve) => {
      const w = window as typeof window & AttributionWindowGlobals;
      const raf = w.__homeNativeRaf;
      if (!raf) { resolve(-1); return; }
      raf(() => resolve(w.__homeNavigationLoaf?.drain() ?? -1));
    })));
    const loaf = await page.evaluate(() => {
      const collector = (window as typeof window & AttributionWindowGlobals).__homeNavigationLoaf;
      if (!collector) throw new Error("The long-animation-frame collector was not installed");
      collector.stop();
      return { supported: collector.supported, entries: collector.entries };
    });
    const reactCollector = options.collectCommits ? await page.evaluate(() => {
      const collector = (window as typeof window & AttributionWindowGlobals).__homeReactCommits;
      return collector ? { commits: collector.commits, injects: collector.injects } : null;
    }) : null;
    let complete: ((data: { dataLossOccurred?: boolean }) => void) | undefined;
    const finished = new Promise<{ dataLossOccurred?: boolean }>((done) => {
      complete = done;
      cdp.once("Tracing.tracingComplete", done);
    });
    let completion: { dataLossOccurred?: boolean };
    try {
      const ending = cdp.send("Tracing.end");
      // Once issued, a stop must not be retried by cleanup if the watchdog rejects.
      traceRunning = false;
      completion = await awaitTraceEnd(ending, finished);
    } finally {
      if (complete) cdp.off("Tracing.tracingComplete", complete);
    }
    const mapped = mapTraceWindows(events, windows, navigationCycles, completion.dataLossOccurred, scenario.legs);
    const renderer = mainThread(events);
    const threadNames = events.filter((event) => event.ph === "M" && event.name === "thread_name").map((event) => event.args?.name ?? "");
    const threadAvailable = {
      rasterMs: threadNames.some((name) => name.startsWith("CompositorTileWorker")), compositorMs: threadNames.includes("Compositor"),
      gpuMs: threadNames.includes("CrGpuMain") || threadNames.includes("GpuMain"), vizMs: threadNames.includes("VizCompositorThread"),
    };
    const samples: NavigationAttributionSample[] = mapped.map((window) => {
      const attributed = attributeWindow(events, window.traceWindow);
      return { path: window.path, leg: window.leg, cycle: window.cycle, latencyMs: window.latencyMs, ...attributed,
        main: renderer ? attributed.main : null,
        threads: { rasterMs: threadAvailable.rasterMs ? attributed.threads.rasterMs : null,
          compositorMs: threadAvailable.compositorMs ? attributed.threads.compositorMs : null,
          gpuMs: threadAvailable.gpuMs ? attributed.threads.gpuMs : null, vizMs: threadAvailable.vizMs ? attributed.threads.vizMs : null },
        ...summarizeLoafWindow(loaf, window),
        ...(options.collectCommits ? summarizeReactWindow(reactCollector, window) : { react: null, reactReason: "React commit collection not requested" }) };
    });
    const availability = reactAvailability(reactCollector);
    return { samples, cpu, topInvokerByPath: loaf.supported ? topInvokerByPath(loaf.entries, mapped) : {},
      hookInjected: options.collectCommits === true && availability.injected,
      reactReason: options.collectCommits ? availability.reason : "React commit collection not requested" };
  } finally {
    cdp.off("Tracing.dataCollected", collect);
    if (traceRunning) await endTraceWithDeadline(() => cdp.send("Tracing.end"));
  }
}

function backScenario(page: Page): AttributionScenario {
  return {
    legs: ["home", "back"], path: (leg) => leg === "home" ? "Back (Home tab)" : "Back (browser history)",
    before: () => navigate(page, "/cash"),
    measure: (leg) => leg === "home" ? home(page) : browserBack(page),
  };
}

async function detailScenario(page: Page): Promise<AttributionScenario> {
  const identity = await selectDetailRow(page);
  await openDetailRow(page, identity, 0);
  await closeDetailRow(page, identity);
  return {
    legs: ["detail"], path: () => "Activity detail",
    measure: async (_leg, cycle) => {
      const latencyMs = await openDetailRow(page, identity, cycle);
      await twoFrames(page);
      await page.waitForTimeout(navigationSettleMs);
      return latencyMs;
    },
    after: () => closeDetailRow(page, identity),
  };
}

async function prepareChromiumFeed(session: Session, baseUrl: string, rows: number, path: "/home" | "/activity", options: { collectCommits?: boolean }) {
  const { page } = session;
  if (options.collectCommits) await page.addInitScript(reactCommitCollectorSource);
  await captureRealPerformance(page);
  await page.clock.install({ time: new Date() });
  await inlineFixtureMark(page);
  const fixture = await installFeed(page, rows);
  await page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded" });
  await ready(page, path);
  await fillFeed(session, rows, fixture.filled, path === "/home" ? "section[data-activity-feed]" : undefined);
  fixture.verify();
}

export async function runChromiumBackAttribution(session: Session, baseUrl: string, rows: number, options: { collectCommits?: boolean } = {}) {
  await prepareChromiumFeed(session, baseUrl, rows, "/home", options);
  await session.page.evaluate<void, "top" | "bottom">(scrollFeedTo, "top");
  await twoFrames(session.page);
  await warmNavigation(session.page, ["/cash"]);
  return collectChromiumAttribution(session, backScenario(session.page), options);
}

export async function runChromiumDetailAttribution(session: Session, baseUrl: string, rows: number, options: { collectCommits?: boolean } = {}) {
  await prepareChromiumFeed(session, baseUrl, rows, "/activity", options);
  const scenario = await detailScenario(session.page);
  await session.page.clock.setFixedTime(new Date());
  return collectChromiumAttribution(session, scenario, options);
}

export async function runWebKitNavigation(browser: Browser, baseUrl: string, rows: number, path: string): Promise<WebKitSample[]> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
  try {
    const page = await context.newPage();
    await seedSignedInSession(page);
    await installApiFixtures(page, { clock: "system" });
    // The harness clock replaces requestAnimationFrame with a synthetic 16 ms cadence and, installed
    // after load, leaves native timers it cannot cancel. WebKit runs without it so frame gaps are
    // real and every timer stays cancellable; only Chromium holds query freshness with the clock.
    await inlineFixtureMark(page);
    const fixture = await installFeed(page, rows);
    await page.goto(`${baseUrl}/home`, { waitUntil: "domcontentloaded" });
    await ready(page, "/home");
    const end = page.locator('section[data-activity-feed] [role="status"]').filter({ hasText: "End of activity" });
    const until = Date.now() + 120_000;
    while (!(fixture.filled() && await end.isVisible()) && Date.now() < until) {
      await page.evaluate<void, "top" | "bottom">(scrollFeedTo, "bottom");
      await page.waitForTimeout(65);
    }
    if (!fixture.filled() || !await end.isVisible()) throw new Error(`WebKit feed fill timed out at ${rows} rows`);
    fixture.verify();
    await page.evaluate<void, "top" | "bottom">(scrollFeedTo, "top");
    await twoFrames(page);
    await warmNavigation(page, [path], { freezeTime: false });
    const samples: WebKitSample[] = [];
    const started = Date.now();
    for (let cycle = 1; cycle <= navigationCycles; cycle++) for (const leg of ["outbound", "home"] as const) {
      await page.evaluate(() => {
        const gaps: number[] = [];
        let previous: number | null = null, frame: number;
        const tick = (now: number) => {
          if (previous !== null) gaps.push(now - previous);
          previous = now;
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        (window as typeof window & AttributionWindowGlobals).__homeFrameGaps = {
          stop: () => { cancelAnimationFrame(frame); return gaps; },
        };
      });
      const latencyMs = leg === "outbound" ? await navigate(page, path) : await home(page);
      const frameGaps = await page.evaluate(() => (window as typeof window & { __homeFrameGaps: { stop: () => number[] } }).__homeFrameGaps.stop());
      samples.push({ path, leg, cycle, latencyMs, frameGaps, frameGapP95Ms: frameGaps.length ? percentile(frameGaps, 0.95) : null,
        frameGapMaxMs: frameGaps.length ? Math.max(...frameGaps) : null, longFrameCount: frameGaps.filter((gap) => gap > 50).length });
    }
    if (Date.now() - started >= 55_000) throw new Error("WebKit navigation windows crossed the 60 s savings poll interval");
    return samples;
  } finally { await context.close(); }
}

async function runWebKitReturnOrDetail(browser: Browser, baseUrl: string, rows: number, path: "/home" | "/activity"): Promise<WebKitSample[]> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
  try {
    const page = await context.newPage();
    await seedSignedInSession(page);
    await installApiFixtures(page, { clock: "system" });
    await inlineFixtureMark(page);
    const fixture = await installFeed(page, rows);
    await page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded" });
    await ready(page, path);
    const section = path === "/home" ? "section[data-activity-feed]" : 'section[aria-label="Activity"]:not(#navigation-panel)';
    const end = page.locator(`${section} [role="status"]`).filter({ hasText: "End of activity" });
    const until = Date.now() + 120_000;
    while (!(fixture.filled() && await end.isVisible()) && Date.now() < until) {
      await page.evaluate<void, "top" | "bottom">(scrollFeedTo, "bottom");
      await page.waitForTimeout(65);
    }
    if (!fixture.filled() || !await end.isVisible()) throw new Error(`WebKit feed fill timed out at ${rows} rows`);
    fixture.verify();
    let scenario: AttributionScenario;
    if (path === "/home") {
      await page.evaluate<void, "top" | "bottom">(scrollFeedTo, "top");
      await twoFrames(page);
      await warmNavigation(page, ["/cash"], { freezeTime: false });
      scenario = backScenario(page);
    } else scenario = await detailScenario(page);
    const samples: WebKitSample[] = [];
    const started = Date.now();
    for (let cycle = 1; cycle <= navigationCycles; cycle++) for (const leg of scenario.legs) {
      await scenario.before?.(leg);
      await page.evaluate(() => {
        const gaps: number[] = [];
        let previous: number | null = null, frame: number;
        const tick = (now: number) => {
          if (previous !== null) gaps.push(now - previous);
          previous = now;
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        (window as typeof window & AttributionWindowGlobals).__homeFrameGaps = {
          stop: () => { cancelAnimationFrame(frame); return gaps; },
        };
      });
      const latencyMs = await scenario.measure(leg, cycle);
      const frameGaps = await page.evaluate(() => (window as typeof window & { __homeFrameGaps: { stop: () => number[] } }).__homeFrameGaps.stop());
      samples.push({ path: scenario.path(leg), leg, cycle, latencyMs, frameGaps, frameGapP95Ms: frameGaps.length ? percentile(frameGaps, 0.95) : null,
        frameGapMaxMs: frameGaps.length ? Math.max(...frameGaps) : null, longFrameCount: frameGaps.filter((gap) => gap > 50).length });
      await scenario.after?.();
    }
    if (Date.now() - started >= 55_000) throw new Error("WebKit navigation windows crossed the 60 s savings poll interval");
    return samples;
  } finally { await context.close(); }
}

export async function runWebKitBackAttribution(browser: Browser, baseUrl: string, rows: number) {
  return runWebKitReturnOrDetail(browser, baseUrl, rows, "/home");
}

export async function runWebKitDetailAttribution(browser: Browser, baseUrl: string, rows: number) {
  return runWebKitReturnOrDetail(browser, baseUrl, rows, "/activity");
}

export function attributionMarkdown(report: NavigationAttributionReport | null): string[] {
  const lines = ["", "## Navigation attribution (report only)", ""];
  if (!report) return [...lines, "— Attribution runs only in a full, unseeded run or with --attribution.",
    ...reactMarkdown(null, [], "No attribution windows collected")];
  const value = (number: number | null | undefined) => number == null ? "—" : String(Math.round(number * 100) / 100);
  const signed = (number: number | null) => number === null ? "—" : `${number >= 0 ? "+" : ""}${value(number)}`;
  const text = (input: string | null) => input === null ? "—" : input.replaceAll("|", "\\|").replace(/[\r\n]/g, " ");
  lines.push(`${report.rows}-row feed; pooled over cycles and measured legs per path. All durations are ms. Chromium uses the existing mobile viewport and CPU throttle; WebKit is desktop and unthrottled.`,
    "Warm round trips report click → destination ready. Back returns to Home from /cash in separate Home-tab and browser-history windows, reporting action → Home ready. Activity detail is the /activity dialog open on the 300-row feed, reporting click → dialog visible.",
    "Attribution windows include two animation frames and the existing 75 ms settle; presented time and pipeline stages are separate, not app latency. Activity detail closes outside the window before the next cycle.",
    "— means unavailable: no samples/plain timing, missing trace thread metadata or complete presenting-frame pipeline, unsupported long-animation-frame observer, no LoAF duration/invoker, or no rAF gaps. Engine failures are named below.",
    "", "### Chromium", "", "| Path | Samples | Latency p50 | Latency p95 | Window p50 | Presented samples | Presented p50 | Presented p95 |", "|---|---:|---:|---:|---:|---:|---:|---:|",
    ...report.chromium.map((row) => `| ${row.path} | ${row.latency.samples} | ${value(row.latency.p50)} | ${value(row.latency.p95)} | ${value(row.windowMs)} | ${row.presented.samples} | ${value(row.presented.p50)} | ${value(row.presented.p95)} |`),
    "", "#### Main thread (per-window medians)", "", "| Path | Script | Forced style | Forced layout | Lifecycle style | Lifecycle layout | Paint | Other | Busy |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...report.chromium.map((row) => `| ${row.path} | ${["scriptMs", "forcedStyleMs", "forcedLayoutMs", "lifecycleStyleMs", "lifecycleLayoutMs", "paintMs", "otherMs", "busyMs"].map((key) => value(row.main[key])).join(" | ")} |`),
    "", "#### Other threads (per-window busy medians)", "", "| Path | Raster | Compositor | GPU | Viz |", "|---|---:|---:|---:|---:|",
    ...report.chromium.map((row) => `| ${row.path} | ${["rasterMs", "compositorMs", "gpuMs", "vizMs"].map((key) => value(row.threads[key])).join(" | ")} |`),
    "", "#### Destination-presenting frame pipeline (not app latency)", "", "| Path | Stage | Samples | Median duration |", "|---|---|---:|---:|",
    ...report.chromium.flatMap((row) => row.pipeline.length ? row.pipeline.map((stage) => `| ${row.path} | ${stage.step} | ${stage.samples} | ${value(stage.durationMs)} |`) : [`| ${row.path} | — | 0 | — |`]),
    "", "#### Long animation frames (start in window, ≥50 ms; totals across windows)", "", "| Path | Supported windows | Count | Total | Blocking | Max | Forced style + layout | Forced share of LoAF duration | Top script invoker |", "|---|---:|---:|---:|---:|---:|---:|---:|---|",
    ...report.chromium.map((row) => `| ${row.path} | ${value(row.loaf?.samples)} | ${value(row.loaf?.count)} | ${value(row.loaf?.totalMs)} | ${value(row.loaf?.blockingMs)} | ${value(row.loaf?.maxMs)} | ${value(row.loaf?.forcedStyleAndLayoutMs)} | ${row.loaf?.forcedSharePct == null ? "—" : `${value(row.loaf.forcedSharePct)}%`} | ${text(row.loaf?.topInvoker ?? null)} |`),
    "", "#### Long animation frames (per frame, start in window, ≥50 ms)", "", "| Window | Start | Duration | Blocking | Style + layout phase | Forced style + layout | Forced share | Top script invoker |", "|---|---:|---:|---:|---:|---:|---:|---|",
    ...report.chromium.flatMap((row) => row.frames.length ? row.frames.map((frame) =>
      `| ${text(`${row.path} ${frame.leg} #${frame.cycle}`)} | ${value(frame.startMs)} | ${value(frame.durationMs)} | ${value(frame.blockingMs)} | ${value(frame.styleAndLayoutMs)} | ${value(frame.forcedStyleAndLayoutMs)} | ${frame.forcedSharePct === null ? "—" : `${value(frame.forcedSharePct)}%`} | ${text(frame.invoker)} |`) : [`| ${row.path} | — | — | — | — | — | — | — |`]),
    "", "#### Instrumentation overhead (attribution − plain, same path/build/rows)", "", "| Path | Plain samples | Attribution samples | Plain p50 | Attribution p50 | Δ p50 | Plain p95 | Attribution p95 | Δ p95 |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...report.chromium.map((row) => `| ${row.path} | ${row.overhead.plain.samples} | ${row.overhead.attribution.samples} | ${value(row.overhead.plain.p50)} | ${value(row.overhead.attribution.p50)} | ${signed(row.overhead.p50DeltaMs)} | ${value(row.overhead.plain.p95)} | ${value(row.overhead.attribution.p95)} | ${signed(row.overhead.p95DeltaMs)} |`),
    ...reactMarkdown(report.react, report.chromium.map((row) => row.path)),
    "", "### Desktop WebKit", "", "WebKit: latency and frame gaps only; Chromium traces and long-animation-frame entries are not available in this engine.",
    `Browser: ${report.webkit.browser ?? "—"}; viewport 1280×800, device scale factor 1; no CDP or CPU throttle.`,
    "", "| Path | Samples | Latency p50 | Latency p95 | Frame gaps | Frame-gap p95 | Frame-gap max | Long frames (>50 ms) |", "|---|---:|---:|---:|---:|---:|---:|---:|",
    ...report.webkit.paths.map((row) => `| ${row.path} | ${row.latency.samples} | ${value(row.latency.p50)} | ${value(row.latency.p95)} | ${row.frames} | ${value(row.frameGapP95Ms)} | ${value(row.frameGapMaxMs)} | ${value(row.longFrameCount)} |`),
    ...report.webkit.errors.map((error) => `WebKit failure (${error.path ?? "launch/close"}): ${text(error.reason)}`));
  return lines;
}

function reactMarkdown(report: ReactAttributionReport | null, paths: string[], fallback = "No profiling build configured"): string[] {
  const value = (number: number | null | undefined) => number == null ? "—" : String(Math.round(number * 100) / 100);
  const text = (input: string) => input.replaceAll("|", "\\|").replace(/[\r\n]/g, " ");
  const rows = report?.paths ?? paths.map((path) => aggregateReact(path, []));
  return ["", "#### React commits (profiling build, per-window medians)", "",
    "The React leg uses a separate profiling build on the same commit. Profiling inflates absolute values; the panel split is the signal. Per-panel commit time is the commit phase of the commits that panel owns: attribution by owning panel, not a per-subtree measurement. Hidden share is of attributed panel render, not all root render; top panel excludes Home.",
    "| Path | Commits | Render | Commit phase | Passive | Top panel | Top panel render | Top panel commit | Other panels (render / commit) | Hidden share |",
    "|---|---:|---:|---:|---:|---|---:|---:|---|---:|",
    ...rows.map((row) => {
      const others = Object.entries(row.panels).filter(([id]) => id !== row.topPanel?.id).map(([id, panel]) => `${text(id)}: ${value(panel.renderMs)} / ${value(panel.commitMs)}`).join(", ") || "—";
      return `| ${row.path} | ${value(row.count)} | ${value(row.renderMs)} | ${value(row.commitMs)} | ${value(row.passiveMs)} | ${row.topPanel ? text(row.topPanel.id) : "—"} | ${value(row.topPanel?.renderMs)} | ${value(row.topPanel?.commitMs)} | ${others} | ${row.hiddenSharePct === null ? "—" : `${value(row.hiddenSharePct)}%`} |`;
    }),
    ...(rows.length ? [] : ["| — | — | — | — | — | — | — | — | — | — |"]),
    ...(report?.reason || !report ? [`React commits unavailable: ${text(report?.reason ?? fallback)}.`] : []),
    ...(report?.hooks.filter((hook) => hook.reason !== null).map((hook) => `React commits unavailable (${hook.path}): ${text(hook.reason ?? "React profiling hook did not inject")}.`) ?? [])];
}
