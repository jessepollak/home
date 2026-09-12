import { afterEach, describe, expect, test } from "bun:test";
import {
  setObservabilityLogWriterForTests,
  writeObservabilityEvent,
} from "./log";

afterEach(() => setObservabilityLogWriterForTests());

describe("observability logging", () => {
  test("writes exactly one scrubbed JSON line", () => {
    const writes: Array<{ line: string; level: string }> = [];
    setObservabilityLogWriterForTests((line, level) => writes.push({ line, level }));

    const result = writeObservabilityEvent({
      kind: "client-error",
      route: "/activity?access_token=raw-access-value",
      errorName: "TypeError",
      summary: "authorization=raw-access-value failed",
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]?.level).toBe("error");
    expect(JSON.parse(writes[0]?.line ?? "{}")).toEqual(result);
    expect(writes[0]?.line).not.toContain("raw-access-value");
  });

  test("writes successful activity reads at info level", () => {
    const writes: Array<{ line: string; level: string }> = [];
    setObservabilityLogWriterForTests((line, level) => writes.push({ line, level }));

    writeObservabilityEvent(activityEvent());

    expect(writes).toHaveLength(1);
    expect(writes[0]?.level).toBe("info");
  });

  test("swallows synchronous writer failures", () => {
    setObservabilityLogWriterForTests(() => {
      throw new Error("log sink unavailable");
    });

    expect(() => writeObservabilityEvent(activityEvent())).not.toThrow();
  });

  test("swallows asynchronous writer rejections without an unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      setObservabilityLogWriterForTests(() =>
        Promise.reject(new Error("async log sink unavailable")),
      );

      expect(() => writeObservabilityEvent(activityEvent())).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

function activityEvent() {
  return {
    kind: "activity-read" as const,
    route: "/api/activity",
    outcome: "succeeded" as const,
    reason: "primary-source" as const,
    source: "cdp-sql" as const,
    durationMs: 100,
    sourceDurationMs: 90,
    sourceAttemptCount: 1,
    pageCount: 1,
    rowCount: 25,
    recordedOperations: "available" as const,
  };
}
