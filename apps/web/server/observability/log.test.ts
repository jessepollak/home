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

  test("swallows writer failures so reporting cannot affect application behavior", () => {
    setObservabilityLogWriterForTests(() => {
      throw new Error("log sink unavailable");
    });

    expect(() =>
      writeObservabilityEvent({
        kind: "unhandled-server-error",
        route: "/app/page",
        errorName: "Error",
      }),
    ).not.toThrow();
  });
});
