import { describe, expect, test } from "bun:test";
import type { HomeStartupReport } from "@/shared/observability/home-startup";
import {
  HOME_STARTUP_TIMEOUT_MS,
  createHomeStartupRecorder,
  markHomePerformance,
} from "./perf-marks";

function fixture() {
  let now = 0;
  let timeout: (() => void) | null = null;
  const sent: HomeStartupReport[] = [];
  const recorder = createHomeStartupRecorder({
    now: () => now,
    scheduleTimeout: (run, delayMs) => {
      expect(delayMs).toBe(HOME_STARTUP_TIMEOUT_MS);
      timeout = run;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: () => { timeout = null; },
    send: (report) => { sent.push(report); },
  });
  return {
    recorder,
    sent,
    at(value: number) { now = value; },
    timeout() { timeout?.(); },
  };
}

describe("Home startup recorder", () => {
  test("emits dashboard ready once and preserves observed numeric order", () => {
    const value = fixture();
    value.recorder.setCache("restored");
    value.recorder.start("/dashboard");
    value.at(10); value.recorder.mark("shell:paint");
    value.at(25); value.recorder.mark("balances:painted");
    value.at(40); value.recorder.mark("session:verified");
    value.at(50); value.recorder.mark("action:first-interactive");
    value.at(60); value.recorder.mark("action:first-interactive");

    expect(value.sent).toEqual([{
      version: 1,
      kind: "home-startup",
      route: "/dashboard",
      outcome: "ready",
      cache: "restored",
      shellMs: 10,
      balancesMs: 25,
      sessionMs: 40,
      interactiveMs: 50,
      totalMs: 50,
    }]);
  });

  test("emits signed-out on either route after shell paint and forces unknown cache", () => {
    for (const route of ["/", "/dashboard"] as const) {
      const value = fixture();
      value.recorder.setCache("cold");
      value.recorder.start(route);
      value.at(3); value.recorder.terminate("signed-out");
      expect(value.sent).toEqual([]);
      value.at(4); value.recorder.mark("shell:paint");
      value.recorder.terminate("unavailable");
      expect(value.sent).toEqual([{
        version: 1,
        kind: "home-startup",
        route,
        outcome: "signed-out",
        cache: "unknown",
        shellMs: 4,
        totalMs: 4,
      }]);
    }
  });

  test("emits unavailable and timeout terminal reports once", () => {
    const unavailable = fixture();
    unavailable.recorder.start("/dashboard");
    unavailable.at(2); unavailable.recorder.mark("shell:paint");
    unavailable.at(5); unavailable.recorder.terminate("unavailable");
    unavailable.timeout();
    expect(unavailable.sent).toHaveLength(1);
    expect(unavailable.sent[0]).toMatchObject({ outcome: "unavailable", totalMs: 5 });

    const timedOut = fixture();
    timedOut.recorder.start("/dashboard");
    timedOut.at(1); timedOut.recorder.mark("shell:paint");
    timedOut.at(4); timedOut.recorder.mark("balances:painted");
    timedOut.at(15_000); timedOut.timeout();
    timedOut.recorder.mark("session:verified");
    expect(timedOut.sent).toEqual([{
      version: 1,
      kind: "home-startup",
      route: "/dashboard",
      outcome: "timeout",
      cache: "unknown",
      shellMs: 1,
      balancesMs: 4,
      totalMs: 15_000,
    }]);
  });

  test("drops a timeout without shell paint and ignores later marks", () => {
    const value = fixture();
    value.recorder.start("/dashboard");
    value.at(15_000); value.timeout();
    value.at(45_000); value.recorder.mark("shell:paint");
    value.recorder.mark("session:verified");
    value.recorder.mark("balances:painted");
    value.recorder.mark("action:first-interactive");

    expect(value.sent).toEqual([]);
  });

  test("buffers marks received before route start", () => {
    const value = fixture();
    value.at(5); value.recorder.mark("action:first-interactive");
    value.at(10); value.recorder.start("/dashboard");
    value.at(20); value.recorder.mark("shell:paint");
    value.at(30); value.recorder.mark("session:verified");
    value.at(40); value.recorder.mark("balances:painted");

    expect(value.sent).toEqual([{
      version: 1,
      kind: "home-startup",
      route: "/dashboard",
      outcome: "ready",
      cache: "unknown",
      shellMs: 20,
      sessionMs: 30,
      balancesMs: 40,
      interactiveMs: 5,
      totalMs: 40,
    }]);
  });

  test("records duplicate-safe browser User Timing marks", () => {
    performance.clearMarks("session:verified");
    markHomePerformance("session:verified");
    markHomePerformance("session:verified");

    expect(performance.getEntriesByName("session:verified", "mark")).toHaveLength(1);
    performance.clearMarks("session:verified");
  });

  test("landing ready needs shell and verified session only", () => {
    const value = fixture();
    value.recorder.start("/");
    value.at(1); value.recorder.mark("session:verified");
    value.at(2); value.recorder.mark("shell:paint");
    expect(value.sent[0]).toMatchObject({ route: "/", outcome: "ready", totalMs: 2 });
  });

  test("reporting failures are isolated", () => {
    const recorder = createHomeStartupRecorder({
      now: () => 1,
      scheduleTimeout: () => 1 as unknown as ReturnType<typeof setTimeout>,
      clearTimeout: () => undefined,
      send: () => { throw new Error("network failure"); },
    });
    recorder.start("/");
    expect(() => {
      recorder.mark("shell:paint");
      recorder.mark("session:verified");
    }).not.toThrow();
  });
});
