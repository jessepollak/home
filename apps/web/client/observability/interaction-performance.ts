import {
  parseClientPerformanceReport,
  type HomeDeviceClass,
  type HomeEngine,
  type HomeInteractionRoute,
  type HomeNavigationReport,
  type HomeNavigationTrigger,
  type HomePanelCacheState,
  type HomeScrollReport,
} from "@/shared/observability/client-performance.contract";
import { sendClientPerformanceReport } from "./perf-marks";

export const HOME_NAVIGATION_REPORT_CAP = 10;
export const HOME_SCROLL_REPORT_CAP = 10;

type TimeoutHandle = ReturnType<typeof setTimeout>;
type Dependencies = {
  now: () => number;
  random: () => number;
  sampleRate: number;
  device: () => HomeDeviceClass;
  engine: () => HomeEngine;
  isVisible: () => boolean;
  requestFrame: (run: () => void) => number;
  cancelFrame: (handle: number) => void;
  scheduleTimeout: (run: () => void, delayMs: number) => TimeoutHandle;
  clearTimeout: (handle: TimeoutHandle) => void;
  observeLongFrames: (onEntry: (startTime: number, duration: number) => void) => (() => void) | null;
  send: (report: HomeNavigationReport | HomeScrollReport) => unknown;
};

type Navigation = {
  to: HomeInteractionRoute;
  from: HomeInteractionRoute;
  cache: HomePanelCacheState;
  trigger: HomeNavigationTrigger;
  startedAt: number;
  frame: number | null;
  timeout: TimeoutHandle | null;
  committed: boolean;
  input?: { startedAt: number; dispatchDelayMs: number };
  contentState?: HomeNavigationReport["contentState"];
};

type ScrollSession = {
  route: HomeInteractionRoute;
  cache: HomePanelCacheState;
  startedAt: number;
  lastScrollAt: number;
  previousFrame: number;
  frameCount: number;
  slowFrameCount: number;
  maxFrameMs: number;
  intervals: { start: number; end: number }[];
  longFrames: { start: number; duration: number }[];
  frame: number | null;
  timeout: TimeoutHandle | null;
  disconnect: (() => void) | null;
  longFramesSupported: boolean;
};

export function createHomeInteractionRecorder(deps: Dependencies) {
  let sampled: boolean | null = null;
  let navigationCount = 0;
  let scrollCount = 0;
  let pending: Navigation | null = null;
  let scroll: ScrollSession | null = null;
  let intentAt: number | null = null;
  let input: Navigation["input"];
  let inputTimer: TimeoutHandle | null = null;
  const persistence: { start: number; end: number }[] = [];

  const enabled = () => {
    if (sampled === null) sampled = deps.random() < deps.sampleRate;
    return sampled;
  };
  const send = (report: HomeNavigationReport | HomeScrollReport) => {
    const parsed = parseClientPerformanceReport(report);
    if (parsed?.kind === report.kind) {
      void Promise.resolve(deps.send(parsed as HomeNavigationReport | HomeScrollReport)).catch(() => undefined);
    }
  };
  const safeCleanup = (run: () => void) => {
    try { run(); } catch { return undefined; }
  };
  const clearInput = () => {
    input = undefined;
    const timer = inputTimer;
    if (timer !== null) safeCleanup(() => deps.clearTimeout(timer));
    inputTimer = null;
  };
  const cancelNavigation = () => {
    if (!pending) return;
    const navigation = pending;
    pending = null;
    const { frame, timeout } = navigation;
    if (frame !== null) safeCleanup(() => deps.cancelFrame(frame));
    if (timeout !== null) safeCleanup(() => deps.clearTimeout(timeout));
  };
  const discardScroll = () => {
    intentAt = null;
    if (!scroll) return;
    const session = scroll;
    scroll = null;
    const { frame, timeout } = session;
    if (frame !== null) safeCleanup(() => deps.cancelFrame(frame));
    if (timeout !== null) safeCleanup(() => deps.clearTimeout(timeout));
    if (session.disconnect) safeCleanup(session.disconnect);
  };
  const frame = (session: ScrollSession) => {
    if (scroll !== session) return;
    try {
      const now = deps.now();
      session.frame = null;
      if (now - session.lastScrollAt > 100) return;
      const gap = Math.max(0, now - session.previousFrame);
      session.previousFrame = now;
      session.frameCount += 1;
      if (gap > 25) session.slowFrameCount += 1;
      session.maxFrameMs = Math.max(session.maxFrameMs, gap);
      session.frame = deps.requestFrame(() => frame(session));
    } catch {
      discardScroll();
    }
  };
  const finishScroll = (session: ScrollSession) => {
    if (scroll !== session) return;
    try {
      discardScroll();
      if (session.frameCount < 3 || !deps.isVisible()) return;
      const measuredLongFrames = session.longFrames.filter(({ start, duration }) =>
        session.intervals.some((interval) => start < interval.end && start + duration > interval.start));
      scrollCount += 1;
      send({ version: 1, kind: "home-scroll", route: session.route, cache: session.cache,
        device: deps.device(), engine: deps.engine(), durationMs: session.lastScrollAt - session.startedAt,
        frameCount: session.frameCount, slowFrameCount: session.slowFrameCount,
        maxFrameMs: session.maxFrameMs,
        ...(session.longFramesSupported ? {
          longFrameCount: measuredLongFrames.length,
          longFrameMs: measuredLongFrames.reduce((total, entry) => total + entry.duration, 0),
        } : {}) });
    } catch {
      return undefined;
    }
  };

  return {
    noteInput(timestamp: number, timeOrigin = 0): void {
      clearInput();
      if (!enabled() || navigationCount >= HOME_NAVIGATION_REPORT_CAP || !deps.isVisible()) return;
      const now = deps.now();
      const startedAt = timestamp > now && timeOrigin > 0 ? timestamp - timeOrigin : timestamp;
      if (!Number.isFinite(startedAt) || startedAt <= 0 || startedAt > now || now - startedAt > 30_000) return;
      input = { startedAt, dispatchDelayMs: now - startedAt };
      inputTimer = deps.scheduleTimeout(clearInput, 0);
    },
    notePersistence(start: number, duration: number): void {
      if (!enabled() || navigationCount >= HOME_NAVIGATION_REPORT_CAP || !deps.isVisible() ||
        !Number.isFinite(start) || !Number.isFinite(duration) || start < 0 || duration < 0) return;
      persistence.push({ start, end: start + duration });
      if (persistence.length > 32) persistence.shift();
    },
    noteContent(to: HomeInteractionRoute, state: NonNullable<HomeNavigationReport["contentState"]>): void {
      if (pending?.to === to) pending.contentState = state;
    },
    beginNavigation({ from, to, cache, trigger }: {
      from: HomeInteractionRoute; to: HomeInteractionRoute;
      cache: HomePanelCacheState; trigger: HomeNavigationTrigger;
    }): void {
      try {
        if (!enabled() || navigationCount >= HOME_NAVIGATION_REPORT_CAP || from === to || !deps.isVisible()) return;
        cancelNavigation();
        discardScroll();
        pending = { from, to, cache, trigger, startedAt: deps.now(), frame: null,
          ...(trigger === "in-app" && input ? { input } : {}),
          timeout: null, committed: false };
        clearInput();
      } catch {
        return undefined;
      }
    },
    commitNavigation(to: HomeInteractionRoute): void {
      try {
        const navigation = pending;
        if (!navigation || navigation.to !== to || navigation.committed) return;
        navigation.committed = true;
        navigation.frame = deps.requestFrame(() => {
          try {
            if (pending !== navigation) return;
            navigation.frame = null;
            navigation.timeout = deps.scheduleTimeout(() => {
              if (pending !== navigation) return;
              try {
                pending = null;
                if (!deps.isVisible()) return;
                navigationCount += 1;
                const now = deps.now();
                const start = navigation.input?.startedAt ?? navigation.startedAt;
                const cachePersistMs = persistence.reduce((sum, span) =>
                  sum + Math.max(0, Math.min(now, span.end) - Math.max(start, span.start)), 0);
                send({ version: 1, kind: "home-navigation", route: to,
                  from: navigation.from, trigger: navigation.trigger, cache: navigation.cache,
                  device: deps.device(), engine: deps.engine(), durationMs: now - navigation.startedAt,
                  cachePersistMs,
                  ...(navigation.contentState ? { contentState: navigation.contentState } : {}),
                  ...(navigation.input ? { dispatchDelayMs: navigation.input.dispatchDelayMs,
                    inputToPaintMs: now - navigation.input.startedAt } : {}) });
              } catch {
                return undefined;
              }
            }, 0);
          } catch {
            cancelNavigation();
          }
        });
      } catch {
        cancelNavigation();
      }
    },
    pageHidden(): void {
      cancelNavigation();
      discardScroll();
      clearInput();
      persistence.length = 0;
    },
    noteScrollIntent(): void {
      try {
        if (enabled() && scrollCount < HOME_SCROLL_REPORT_CAP) intentAt = deps.now();
      } catch {
        return undefined;
      }
    },
    noteScroll({ route, cache }: { route: HomeInteractionRoute; cache: HomePanelCacheState }): void {
      try {
        if (!enabled() || scrollCount >= HOME_SCROLL_REPORT_CAP) return;
        if (scroll && (scroll.route !== route || scroll.cache !== cache)) {
          discardScroll();
          return;
        }
        const now = deps.now();
        if (!scroll) {
          if (intentAt === null || now - intentAt > 1_000 || now < intentAt) return;
          const session: ScrollSession = {
            route, cache, startedAt: now, lastScrollAt: now, previousFrame: now, frameCount: 0,
            slowFrameCount: 0, maxFrameMs: 0, intervals: [{ start: now, end: now + 100 }],
            longFrames: [], frame: null, timeout: null, disconnect: null, longFramesSupported: false,
          };
          scroll = session;
          session.disconnect = deps.observeLongFrames((startTime, duration) => {
            try {
              if (scroll !== session || startTime + duration <= session.startedAt ||
                startTime > deps.now()) return;
              session.longFrames.push({ start: startTime, duration });
            } catch {
              return undefined;
            }
          });
          session.longFramesSupported = session.disconnect !== null;
          session.frame = deps.requestFrame(() => frame(session));
        }
        const session = scroll;
        const resumed = now - session.lastScrollAt > 100;
        if (resumed) {
          session.intervals.push({ start: now, end: now + 100 });
          if (session.frame !== null) deps.cancelFrame(session.frame);
          session.frame = null;
        } else {
          session.intervals[session.intervals.length - 1].end = now + 100;
        }
        session.lastScrollAt = now;
        if (session.frame === null) {
          session.previousFrame = now;
          session.frame = deps.requestFrame(() => frame(session));
        }
        if (session.timeout !== null) deps.clearTimeout(session.timeout);
        session.timeout = deps.scheduleTimeout(() => finishScroll(session), 300);
      } catch {
        discardScroll();
        return undefined;
      }
    },
    discardScroll(): void {
      try { discardScroll(); } catch { scroll = null; intentAt = null; return undefined; }
    },
  };
}

export function classifyHomeDevice({ coarsePointer, hardwareConcurrency, deviceMemory }: {
  coarsePointer: boolean; hardwareConcurrency?: number; deviceMemory?: number;
}): HomeDeviceClass {
  const prefix = coarsePointer ? "mobile" : "desktop";
  const concurrency = Number.isFinite(hardwareConcurrency) ? hardwareConcurrency : undefined;
  const memory = Number.isFinite(deviceMemory) ? deviceMemory : undefined;
  const tier = concurrency === undefined && memory === undefined ? "unknown"
    : (concurrency !== undefined && concurrency <= 4) || (memory !== undefined && memory <= 4) ? "low" : "high";
  return `${prefix}-${tier}`;
}

export function classifyHomeEngine(userAgent: string): HomeEngine {
  if (/(?:iPhone|iPad|iPod)/i.test(userAgent)) return "webkit";
  if (/Firefox\//i.test(userAgent)) return "gecko";
  if (/(?:Chrome|Chromium)\//i.test(userAgent)) return "chromium";
  if (/AppleWebKit\//i.test(userAgent)) return "webkit";
  return "other";
}

export function resolveHomeInteractionSampleRate(raw: string | undefined): number {
  if (raw === undefined || !/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(raw)) return 0.25;
  return Number(raw);
}

const recorder = createHomeInteractionRecorder({
  now: () => performance.now(),
  random: () => Math.random(),
  sampleRate: resolveHomeInteractionSampleRate(process.env.NEXT_PUBLIC_HOME_INTERACTION_SAMPLE_RATE),
  device: () => classifyHomeDevice({
    coarsePointer: window.matchMedia("(pointer: coarse)").matches,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
  }),
  engine: () => classifyHomeEngine(navigator.userAgent),
  isVisible: () => document.visibilityState === "visible",
  requestFrame: (run) => requestAnimationFrame(run),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
  scheduleTimeout: (run, delayMs) => setTimeout(run, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
  observeLongFrames: (onEntry) => {
    if (typeof PerformanceObserver === "undefined" ||
      !PerformanceObserver.supportedEntryTypes?.includes("long-animation-frame")) return null;
    const observer = new PerformanceObserver((list) => {
      try {
        for (const entry of list.getEntries()) onEntry(entry.startTime, entry.duration);
      } catch {
        return undefined;
      }
    });
    observer.observe({ type: "long-animation-frame" });
    return () => observer.disconnect();
  },
  send: sendClientPerformanceReport,
});

export function beginHomeNavigation(input: Parameters<typeof recorder.beginNavigation>[0]): void {
  try { recorder.beginNavigation(input); } catch { return undefined; }
}

export function noteHomeNavigationInput(event: MouseEvent): void {
  if (!event.isTrusted) return;
  try { recorder.noteInput(event.timeStamp, performance.timeOrigin); } catch { return undefined; }
}

export function recordHomeCachePersistence(startedAt: number, durationMs: number): void {
  try { recorder.notePersistence(startedAt, durationMs); } catch { return undefined; }
}

export function noteHomeNavigationContent(route: HomeInteractionRoute, state: NonNullable<HomeNavigationReport["contentState"]>): void {
  try { recorder.noteContent(route, state); } catch { return undefined; }
}

export function commitHomeNavigation(to: HomeInteractionRoute): void {
  try { recorder.commitNavigation(to); } catch { return undefined; }
}

export function noteHomeScrollIntent(): void {
  try { recorder.noteScrollIntent(); } catch { return undefined; }
}

export function noteHomeScroll(input: Parameters<typeof recorder.noteScroll>[0]): void {
  try { recorder.noteScroll(input); } catch { return undefined; }
}

export function discardHomeScroll(): void {
  try { recorder.discardScroll(); } catch { return undefined; }
}

export function discardHomeInteractionSamples(): void {
  try { recorder.pageHidden(); } catch { return undefined; }
}
