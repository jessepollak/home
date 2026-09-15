import {
  normalizeHomeStartupRoute,
  parseClientPerformanceReport,
  type HomeAuthHint,
  type HomeAuthOutcome,
  type HomeAuthRestoreReport,
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

  const finish = (
    outcome: HomeAuthOutcome,
    settledAt = dependencies.now(),
  ): HomeAuthRestoreReport | null => {
    if (terminal || route === null) return null;
    terminal = true;
    if (timeout !== null) dependencies.clearTimeout(timeout);
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
      sessionSettledMs: duration(settledAt),
      totalMs: duration(settledAt),
    };
    try {
      void dependencies.send(report);
    } catch {
      // Auth performance reporting never affects authentication.
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

export async function sendHomeAuthRestoreReport(report: HomeAuthRestoreReport): Promise<void> {
  const parsedReport = parseClientPerformanceReport(report);
  if (!parsedReport || parsedReport.kind !== "home-auth-phase") return;
  try {
    await fetch(CLIENT_PERFORMANCE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parsedReport),
      credentials: "omit",
      cache: "no-store",
      keepalive: true,
      referrerPolicy: "no-referrer",
    });
  } catch {
    // Delivery failure never affects authentication.
  }
}

const recorder = createHomeAuthRestoreRecorder({
  now: () => typeof performance === "undefined" ? 0 : performance.now(),
  scheduleTimeout: (run, delayMs) => setTimeout(run, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
  send: sendHomeAuthRestoreReport,
});

export function startHomeAuthRestore(hint: HomeAuthHint): void {
  try {
    if (typeof window === "undefined") return;
    // Canonical routes normalize to their L1 label; dynamic segments never leak.
    const route = normalizeHomeStartupRoute(window.location.pathname);
    if (!route) return;
    recorder.start(route, hint);
  } catch {
    // Auth performance reporting never affects authentication.
  }
}

export function markHomeAuthRestore(name: HomeAuthRestoreMark): void {
  try {
    recorder.mark(name);
  } catch {
    // Auth performance reporting never affects authentication.
  }
}

export function finishHomeAuthRestore(outcome: Exclude<HomeAuthOutcome, "timeout">): void {
  try {
    recorder.terminate(outcome);
  } catch {
    // Auth performance reporting never affects authentication.
  }
}
