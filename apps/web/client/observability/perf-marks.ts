import type {
  HomeStartupCacheState,
  HomeStartupOutcome,
  HomeStartupReport,
  HomeStartupRoute,
} from "@/shared/observability/home-startup";

export const HOME_PERFORMANCE_MARKS = [
  "shell:paint",
  "session:verified",
  "balances:painted",
  "action:first-interactive",
] as const;

export type HomePerformanceMark = (typeof HOME_PERFORMANCE_MARKS)[number];
export const CLIENT_PERFORMANCE_ENDPOINT = "/api/client-performance";
export const HOME_STARTUP_TIMEOUT_MS = 15_000;

type TimeoutHandle = ReturnType<typeof setTimeout>;
type RecorderDependencies = {
  now: () => number;
  scheduleTimeout: (run: () => void, delayMs: number) => TimeoutHandle;
  clearTimeout: (handle: TimeoutHandle) => void;
  send: (report: HomeStartupReport) => unknown;
};

export function createHomeStartupRecorder(dependencies: RecorderDependencies) {
  let route: HomeStartupRoute | null = null;
  let cache: HomeStartupCacheState = "unknown";
  let terminal = false;
  let pendingOutcome: Exclude<HomeStartupOutcome, "ready" | "timeout"> | null = null;
  let timeout: TimeoutHandle | null = null;
  const marks = new Map<HomePerformanceMark, number>();

  const finish = (outcome: HomeStartupOutcome): HomeStartupReport | null => {
    if (terminal || route === null) return null;
    const shellMs = marks.get("shell:paint");
    if (shellMs === undefined) {
      if (outcome === "timeout") {
        terminal = true;
        if (timeout !== null) dependencies.clearTimeout(timeout);
      } else if (outcome === "signed-out" || outcome === "unavailable") {
        pendingOutcome = outcome;
      }
      return null;
    }
    terminal = true;
    if (timeout !== null) dependencies.clearTimeout(timeout);
    if (outcome === "signed-out") cache = "unknown";
    const report: HomeStartupReport = {
      version: 1,
      kind: "home-startup",
      route,
      outcome,
      cache,
      shellMs: duration(shellMs),
      ...(marks.has("session:verified")
        ? { sessionMs: duration(marks.get("session:verified")!) }
        : {}),
      ...(marks.has("balances:painted")
        ? { balancesMs: duration(marks.get("balances:painted")!) }
        : {}),
      ...(marks.has("action:first-interactive")
        ? { interactiveMs: duration(marks.get("action:first-interactive")!) }
        : {}),
      totalMs: duration(dependencies.now()),
    };
    try {
      void dependencies.send(report);
    } catch {
      // Performance instrumentation never affects the application.
    }
    return report;
  };

  const maybeFinishReady = (): HomeStartupReport | null => {
    if (route === null || terminal || !marks.has("shell:paint") || !marks.has("session:verified")) {
      return null;
    }
    if (
      route === "/dashboard" &&
      (!marks.has("balances:painted") || !marks.has("action:first-interactive"))
    ) {
      return null;
    }
    return finish("ready");
  };

  return {
    start(initialRoute: HomeStartupRoute): void {
      if (route !== null || terminal) return;
      route = initialRoute;
      timeout = dependencies.scheduleTimeout(() => finish("timeout"), HOME_STARTUP_TIMEOUT_MS);
      maybeFinishReady();
    },
    mark(name: HomePerformanceMark): HomeStartupReport | null {
      if (terminal) return null;
      if (!marks.has(name)) marks.set(name, dependencies.now());
      if (name === "shell:paint" && pendingOutcome !== null) {
        const outcome = pendingOutcome;
        pendingOutcome = null;
        return finish(outcome);
      }
      return maybeFinishReady();
    },
    setCache(nextCache: HomeStartupCacheState): void {
      if (!terminal) cache = nextCache;
    },
    terminate(outcome: "signed-out" | "unavailable"): HomeStartupReport | null {
      return finish(outcome);
    },
  };
}

function duration(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(60_000, Math.max(0, Math.round(value)));
}

async function sendHomeStartupReport(report: HomeStartupReport): Promise<void> {
  try {
    await fetch(CLIENT_PERFORMANCE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report),
      credentials: "omit",
      cache: "no-store",
      keepalive: true,
      referrerPolicy: "no-referrer",
    });
  } catch {
    // Delivery failure never affects startup.
  }
}

const recorder = createHomeStartupRecorder({
  now: () => typeof performance === "undefined" ? 0 : performance.now(),
  scheduleTimeout: (run, delayMs) => setTimeout(run, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
  send: sendHomeStartupReport,
});

export function startHomePerformance(route: HomeStartupRoute): void {
  try {
    recorder.start(route);
  } catch {
    // Performance instrumentation never affects the application.
  }
}

export function markHomePerformance(name: HomePerformanceMark): void {
  try {
    if (
      typeof performance !== "undefined" &&
      performance.getEntriesByName(name, "mark").length === 0
    ) {
      performance.mark(name);
    }
    recorder.mark(name);
  } catch {
    // Performance instrumentation never affects the application.
  }
}

export function markHomeStartupOutcome(outcome: "signed-out" | "unavailable"): void {
  try {
    recorder.terminate(outcome);
  } catch {
    // Performance instrumentation never affects the application.
  }
}

export function recordHomeStartupCache(cache: HomeStartupCacheState): void {
  try {
    recorder.setCache(cache);
  } catch {
    // Performance instrumentation never affects the application.
  }
}
