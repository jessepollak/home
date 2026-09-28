import {
  normalizeHomeStartupRoute,
  parseClientPerformanceReport,
  type HomeAuthHint,
  type HomeAuthOutcome,
  type HomeAuthRestoreReport,
  type HomeAuthRestoreStage,
  type HomeAuthSignOutReport,
  type HomeStartupRoute,
} from "@/shared/observability/client-performance.contract";
import { CLIENT_PERFORMANCE_ENDPOINT } from "./perf-marks";

export const HOME_AUTH_RESTORE_TIMEOUT_MS = 15_000;

export type HomeAuthRestoreMark = "sdk-activate" | "cdp-initialized" | "native-settled";
type TimeoutHandle = ReturnType<typeof setTimeout>;
type RecorderDependencies = {
  now: () => number;
  scheduleTimeout: (run: () => void, delayMs: number) => TimeoutHandle;
  clearTimeout: (handle: TimeoutHandle) => void;
  send: (report: HomeAuthRestoreReport) => unknown;
};

/** @public exercised by client/observability/auth-performance.test.ts */
export function createHomeAuthRestoreRecorder(dependencies: RecorderDependencies) {
  let route: HomeStartupRoute | null = null;
  let hint: HomeAuthHint = "none";
  let terminal = false;
  let timeout: TimeoutHandle | null = null;
  let pendingTerminal: {
    outcome: Exclude<HomeAuthOutcome, "timeout">;
    settledAt: number;
  } | null = null;
  const marks = new Map<HomeAuthRestoreMark, number>();
  const stageStarts = new Map<HomeAuthRestoreStage, number>();
  const stageDurations = new Map<HomeAuthRestoreStage, number>();
  let timedOutStage: HomeAuthRestoreStage | null = null;

  const finish = (
    outcome: HomeAuthOutcome,
    settledAt = dependencies.now(),
  ): HomeAuthRestoreReport | null => {
    if (terminal || route === null) return null;
    terminal = true;
    if (timeout !== null) dependencies.clearTimeout(timeout);
    const stageDuration = (stage: HomeAuthRestoreStage): number | undefined => {
      const startedAt = stageStarts.get(stage);
      if (startedAt === undefined) return undefined;
      return stageDurations.get(stage) ?? duration(settledAt - startedAt);
    };
    const tokenMs = stageDuration("token");
    const validationMs = stageDuration("validation");
    const stalledStage = timedOutStage ??
      (stageStarts.has("validation") && !stageDurations.has("validation") ? "validation" : null) ??
      (stageStarts.has("token") && !stageDurations.has("token") ? "token" : null);
    const report: HomeAuthRestoreReport = {
      version: 1,
      kind: "home-auth-phase",
      route,
      flow: "restore",
      hint,
      outcome,
      ...(marks.has("sdk-activate")
        ? { sdkActivateMs: duration(marks.get("sdk-activate")!) }
        : {}),
      ...(marks.has("cdp-initialized")
        ? { cdpInitializedMs: duration(marks.get("cdp-initialized")!) }
        : {}),
      ...(marks.has("native-settled")
        ? { nativeSettledMs: duration(marks.get("native-settled")!) }
        : {}),
      ...(tokenMs === undefined ? {} : { tokenMs }),
      ...(validationMs === undefined ? {} : { validationMs }),
      ...(stalledStage === null ? {} : { stalledStage }),
      sessionSettledMs: duration(settledAt),
      totalMs: duration(settledAt),
    };
    try {
      void dependencies.send(report);
    } catch {
    }
    return report;
  };

  return {
    start(initialRoute: HomeStartupRoute, initialHint: HomeAuthHint): void {
      if (route !== null || terminal) return;
      route = initialRoute;
      hint = initialHint;
      if (pendingTerminal !== null) {
        const pending = pendingTerminal;
        pendingTerminal = null;
        finish(pending.outcome, pending.settledAt);
        return;
      }
      const remainingTimeoutMs = Math.max(0, HOME_AUTH_RESTORE_TIMEOUT_MS - dependencies.now());
      if (remainingTimeoutMs === 0) finish("timeout");
      else timeout = dependencies.scheduleTimeout(() => finish("timeout"), remainingTimeoutMs);
    },
    mark(name: HomeAuthRestoreMark): void {
      if (terminal || marks.has(name)) return;
      marks.set(name, dependencies.now());
    },
    beginStage(stage: HomeAuthRestoreStage): void {
      if (terminal || pendingTerminal !== null || stageStarts.has(stage)) return;
      stageStarts.set(stage, dependencies.now());
    },
    endStage(stage: HomeAuthRestoreStage, outcome: "settled" | "timeout" | "cancelled"): void {
      const startedAt = stageStarts.get(stage);
      if (terminal || pendingTerminal !== null || startedAt === undefined || stageDurations.has(stage)) return;
      if (outcome === "cancelled") {
        stageStarts.delete(stage);
        return;
      }
      stageDurations.set(stage, duration(dependencies.now() - startedAt));
      if (outcome === "timeout") timedOutStage ??= stage;
    },
    terminate(outcome: Exclude<HomeAuthOutcome, "timeout">): HomeAuthRestoreReport | null {
      if (terminal) return null;
      if (route === null) {
        pendingTerminal ??= { outcome, settledAt: dependencies.now() };
        return null;
      }
      return finish(outcome);
    },
  };
}

function duration(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(30_000, Math.max(0, Math.round(value / 50) * 50));
}

export async function sendHomeAuthReport(
  report: HomeAuthRestoreReport | HomeAuthSignOutReport,
): Promise<void> {
  const parsedReport = parseClientPerformanceReport(report);
  if (!parsedReport || parsedReport.kind !== "home-auth-phase") return;
  try {
    await fetch(`${CLIENT_PERFORMANCE_ENDPOINT}?kind=${encodeURIComponent(parsedReport.kind)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parsedReport),
      credentials: "same-origin",
      cache: "no-store",
      keepalive: true,
      referrerPolicy: "no-referrer",
    });
  } catch {
  }
}

const recorder = createHomeAuthRestoreRecorder({
  now: () => typeof performance === "undefined" ? 0 : performance.now(),
  scheduleTimeout: (run, delayMs) => setTimeout(run, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
  send: sendHomeAuthReport,
});

export function sendHomeAuthSignOut(report: Omit<HomeAuthSignOutReport, "version" | "kind">): void {
  try {
    void sendHomeAuthReport({ version: 1, kind: "home-auth-phase", ...report });
  } catch {
  }
}

export function startHomeAuthRestore(hint: HomeAuthHint): void {
  try {
    if (typeof window === "undefined") return;
    const route = normalizeHomeStartupRoute(window.location.pathname);
    if (!route) return;
    recorder.start(route, hint);
  } catch {
  }
}

export function markHomeAuthRestore(name: HomeAuthRestoreMark): void {
  try {
    recorder.mark(name);
  } catch {
  }
}

/** @public called by account restore lifecycle */
export function beginHomeAuthRestoreStage(stage: HomeAuthRestoreStage): void {
  try {
    recorder.beginStage(stage);
  } catch {
  }
}

/** @public called by account restore lifecycle */
export function endHomeAuthRestoreStage(stage: HomeAuthRestoreStage, outcome: "settled" | "timeout" | "cancelled"): void {
  try {
    recorder.endStage(stage, outcome);
  } catch {
  }
}

export function finishHomeAuthRestore(outcome: Exclude<HomeAuthOutcome, "timeout">): void {
  try {
    recorder.terminate(outcome);
  } catch {
  }
}
