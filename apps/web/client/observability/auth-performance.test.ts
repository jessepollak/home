import { describe, expect, test } from "bun:test";
import type { HomeAuthRestoreReport } from "@/shared/observability/client-performance.contract";
import {
  HOME_AUTH_RESTORE_TIMEOUT_MS,
  createHomeAuthRestoreRecorder,
  sendHomeAuthRestoreReport,
} from "./auth-performance";

function fixture() {
  let now = 0;
  let timeout: (() => void) | null = null;
  const scheduled: number[] = [];
  const sent: HomeAuthRestoreReport[] = [];
  const recorder = createHomeAuthRestoreRecorder({
    now: () => now,
    scheduleTimeout: (run, delay) => {
      timeout = run;
      scheduled.push(delay);
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: () => { timeout = null; },
    send: (report) => { sent.push(report); },
  });
  return {
    recorder,
    sent,
    scheduled,
    at(value: number) { now = value; },
    timeout() { timeout?.(); },
  };
}

describe("Home auth restore performance recorder", () => {
  test("emits one closed navigation-relative restore report", () => {
    const value = fixture();
    value.at(120); value.recorder.start("/dashboard", "base");
    value.at(180); value.recorder.mark("sdk-activate");
    value.at(525); value.recorder.mark("native-settled");
    value.at(980); value.recorder.mark("cdp-initialized");
    value.at(1_024); value.recorder.terminate("verified");
    value.at(2_000); value.recorder.terminate("unavailable");

    expect(value.scheduled).toEqual([HOME_AUTH_RESTORE_TIMEOUT_MS - 120]);
    expect(value.sent).toEqual([{
      version: 1,
      kind: "home-auth-phase",
      route: "/dashboard",
      flow: "restore",
      hint: "base",
      outcome: "verified",
      sdkActivateMs: 200,
      nativeSettledMs: 550,
      cdpInitializedMs: 1_000,
      sessionSettledMs: 1_000,
      totalMs: 1_000,
    }]);
  });

  test("buffers early marks and terminal settlement until start", () => {
    const value = fixture();
    value.at(75); value.recorder.mark("native-settled");
    value.at(125); value.recorder.terminate("signed-out");
    value.at(150); value.recorder.start("/", "none");
    expect(value.sent[0]).toEqual({
      version: 1,
      kind: "home-auth-phase",
      route: "/",
      flow: "restore",
      hint: "none",
      outcome: "signed-out",
      nativeSettledMs: 100,
      sessionSettledMs: 150,
      totalMs: 150,
    });
  });

  test("emits a partial timeout and caps all fields at 30 seconds", () => {
    const value = fixture();
    value.at(20_000); value.recorder.mark("sdk-activate");
    value.at(14_000); value.recorder.start("/", "cdp");
    expect(value.scheduled).toEqual([1_000]);
    value.at(31_000); value.timeout();
    expect(value.sent[0]).toMatchObject({
      outcome: "timeout",
      sdkActivateMs: 20_000,
      sessionSettledMs: 30_000,
      totalMs: 30_000,
    });
  });

  test("isolates recorder and transport failures", async () => {
    let now = 0;
    const recorder = createHomeAuthRestoreRecorder({
      now: () => now,
      scheduleTimeout: () => 1 as unknown as ReturnType<typeof setTimeout>,
      clearTimeout: () => undefined,
      send: () => { throw new Error("sink failed"); },
    });
    recorder.start("/", "none");
    now = 100;
    expect(() => recorder.terminate("signed-out")).not.toThrow();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => { throw new Error("transport failed"); }) as unknown as typeof fetch;
    try {
      await expect(sendHomeAuthRestoreReport({
        version: 1,
        kind: "home-auth-phase",
        route: "/",
        flow: "restore",
        hint: "none",
        outcome: "signed-out",
        sessionSettledMs: 100,
        totalMs: 100,
      })).resolves.toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
