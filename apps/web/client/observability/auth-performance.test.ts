import { describe, expect, test } from "bun:test";
import type { HomeAuthRestoreReport } from "@/shared/observability/client-performance.contract";
import {
  HOME_AUTH_RESTORE_TIMEOUT_MS,
  createHomeAuthRestoreRecorder,
  sendHomeAuthReport,
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
    value.at(120); value.recorder.start("/home", "base");
    value.at(180); value.recorder.mark("sdk-activate");
    value.at(525); value.recorder.mark("native-settled");
    value.at(980); value.recorder.mark("cdp-initialized");
    value.at(1_024); value.recorder.terminate("verified");
    value.at(2_000); value.recorder.terminate("unavailable");

    expect(value.scheduled).toEqual([HOME_AUTH_RESTORE_TIMEOUT_MS - 120]);
    expect(value.sent).toEqual([{
      version: 1,
      kind: "home-auth-phase",
      route: "/home",
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

  test("records first-attempt settled stage durations without a stall", () => {
    const value = fixture();
    value.at(100); value.recorder.start("/home", "cdp");
    value.recorder.endStage("token", "timeout");
    value.at(125); value.recorder.beginStage("token");
    value.at(200); value.recorder.beginStage("token");
    value.at(280); value.recorder.endStage("token", "settled");
    value.at(300); value.recorder.beginStage("validation");
    value.at(350); value.recorder.endStage("token", "timeout");
    value.at(451); value.recorder.endStage("validation", "settled");
    value.at(550); value.recorder.terminate("verified");
    expect(value.sent[0]).toMatchObject({ tokenMs: 150, validationMs: 150 });
    expect(value.sent[0]).not.toHaveProperty("stalledStage");
  });

  test("measures a replacement stage after cancellation and reports its timeout", () => {
    const value = fixture();
    value.recorder.start("/home", "cdp");
    value.at(100); value.recorder.beginStage("token");
    value.at(450); value.recorder.endStage("token", "cancelled");
    value.at(700); value.recorder.beginStage("token");
    value.at(8_700); value.recorder.endStage("token", "timeout");
    value.recorder.terminate("unavailable");
    expect(value.sent[0]).toMatchObject({
      outcome: "unavailable", tokenMs: 8_000, stalledStage: "token",
    });
  });

  test("ignores cancellation after a stage has ended", () => {
    const value = fixture();
    value.recorder.start("/home", "base");
    value.at(100); value.recorder.beginStage("validation");
    value.at(250); value.recorder.endStage("validation", "settled");
    value.at(350); value.recorder.endStage("validation", "cancelled");
    value.recorder.beginStage("validation");
    value.at(500); value.recorder.terminate("verified");
    expect(value.sent[0]).toMatchObject({ validationMs: 150 });
    expect(value.sent[0]).not.toHaveProperty("stalledStage");
  });

  test("omits a cancelled in-flight stage at terminal settlement", () => {
    const value = fixture();
    value.recorder.start("/home", "cdp");
    value.at(100); value.recorder.beginStage("token");
    value.at(350); value.recorder.endStage("token", "cancelled");
    value.at(500); value.recorder.terminate("signed-out");
    expect(value.sent[0]).not.toHaveProperty("tokenMs");
    expect(value.sent[0]).not.toHaveProperty("stalledStage");
  });

  test("prefers an explicit stage timeout over another in-flight stage", () => {
    const value = fixture();
    value.recorder.start("/", "base");
    value.at(100); value.recorder.beginStage("token");
    value.at(211); value.recorder.endStage("token", "timeout");
    value.at(300); value.recorder.beginStage("validation");
    value.at(500); value.recorder.terminate("unavailable");
    expect(value.sent[0]).toMatchObject({
      outcome: "unavailable", tokenMs: 100, validationMs: 200, stalledStage: "token",
    });
  });

  test("records an in-flight stage at the recorder timeout", () => {
    const value = fixture();
    value.recorder.start("/", "cdp");
    value.at(100); value.recorder.beginStage("token");
    value.at(260); value.recorder.endStage("token", "settled");
    value.at(400); value.recorder.beginStage("validation");
    value.at(HOME_AUTH_RESTORE_TIMEOUT_MS); value.timeout();
    expect(value.sent[0]).toMatchObject({
      outcome: "timeout", tokenMs: 150, validationMs: 14_600, stalledStage: "validation",
    });
  });

  test("uses pending terminal time for in-flight stages and ignores stages after terminal", () => {
    const value = fixture();
    value.at(50); value.recorder.beginStage("token");
    value.at(175); value.recorder.terminate("signed-out");
    value.at(300); value.recorder.endStage("token", "settled");
    value.recorder.beginStage("validation");
    value.at(400); value.recorder.start("/", "none");
    value.at(500); value.recorder.endStage("token", "timeout");
    value.recorder.beginStage("validation");
    value.recorder.endStage("validation", "timeout");
    expect(value.sent).toEqual([{
      version: 1,
      kind: "home-auth-phase",
      route: "/",
      flow: "restore",
      hint: "none",
      outcome: "signed-out",
      tokenMs: 150,
      stalledStage: "token",
      sessionSettledMs: 200,
      totalMs: 200,
    }]);
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
      await expect(sendHomeAuthReport({
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

  test("sends the auth beacon to the same-origin endpoint with deployment credentials", async () => {
    const originalFetch = globalThis.fetch;
    const calls: { input: string; init?: RequestInit }[] = [];
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ input: String(input), init });
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    try {
      await sendHomeAuthReport({
        version: 1,
        kind: "home-auth-phase",
        route: "/home",
        flow: "restore",
        hint: "base",
        outcome: "verified",
        sessionSettledMs: 1_000,
        totalMs: 1_000,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe("/api/client-performance?kind=home-auth-phase");
    expect(calls[0]?.init?.credentials).toBe("same-origin");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.keepalive).toBe(true);
  });
});
