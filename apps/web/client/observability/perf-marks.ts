import { reportClientError } from "./client-reporter";

export const HOME_PERFORMANCE_MARKS = [
  "shell:paint",
  "session:verified",
  "wallet:ready",
  "balances:painted",
  "action:first-interactive",
  "activity:first-row",
  "save:ready",
  "invest:ready",
] as const;

export type HomePerformanceMark = (typeof HOME_PERFORMANCE_MARKS)[number];
export type HomePerformanceEvent = {
  kind: "performance-marks";
  route: string;
  marksFromTimeOriginMs: Record<HomePerformanceMark, number>;
};

const sentKey = "home:observability:performance-marks:v1";

export function markHomePerformance(name: HomePerformanceMark): void {
  if (typeof window === "undefined" || typeof performance === "undefined") return;
  if (performance.getEntriesByName(name, "mark").length === 0) {
    performance.mark(name);
  }
  shipHomePerformanceMarks();
}

export function readHomePerformanceEvent(): HomePerformanceEvent | null {
  if (typeof window === "undefined" || typeof performance === "undefined") return null;
  const marks = Object.fromEntries(
    HOME_PERFORMANCE_MARKS.map((name) => {
      const entry = performance.getEntriesByName(name, "mark")[0];
      return [name, entry ? Math.round(entry.startTime) : null];
    }),
  ) as Record<HomePerformanceMark, number | null>;
  if (HOME_PERFORMANCE_MARKS.some((name) => marks[name] === null)) return null;
  return {
    kind: "performance-marks",
    route: window.location.pathname,
    marksFromTimeOriginMs: marks as Record<HomePerformanceMark, number>,
  };
}

export function shipHomePerformanceMarks(): void {
  try {
    if (window.sessionStorage.getItem(sentKey) === "1") return;
    const event = readHomePerformanceEvent();
    if (!event) return;
    window.sessionStorage.setItem(sentKey, "1");
    const summary = HOME_PERFORMANCE_MARKS
      .map((name) => `${name}=${event.marksFromTimeOriginMs[name]}`)
      .join(",");
    void reportClientError({
      name: "HomePerformanceMarks",
      message: `performance-marks:${summary}`,
      route: event.route,
    });
  } catch {
    // Performance instrumentation never affects the application.
  }
}
