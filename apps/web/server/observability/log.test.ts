import { afterEach, describe, expect, test } from "bun:test";
import {
  OBSERVABILITY_SCHEMA,
  buildObservabilityLogLine,
  readLoggedAccountProvider,
  setObservabilityLogWriterForTests,
  writeStructuredLog,
} from "./log";

afterEach(() => {
  setObservabilityLogWriterForTests();
});

describe("structured observability logs", () => {
  test("emits one JSON line with route, status, errorCode, and accountProvider", () => {
    const lines: Array<{ line: string; level: string }> = [];
    setObservabilityLogWriterForTests((line, level) => {
      lines.push({ line, level });
    });

    const written = writeStructuredLog({
      kind: "request",
      route: "GET /api/activity",
      status: 502,
      errorCode: "ACTIVITY_UNAVAILABLE",
      accountProvider: "cdp-embedded",
      message: "Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig leaked",
    });

    expect(written).toEqual({
      schema: OBSERVABILITY_SCHEMA,
      kind: "request",
      route: "GET /api/activity",
      status: 502,
      errorCode: "ACTIVITY_UNAVAILABLE",
      accountProvider: "cdp-embedded",
      message: "Bearer [REDACTED] leaked",
      level: "error",
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe("error");
    expect(JSON.parse(lines[0]?.line ?? "{}")).toEqual(written);
    expect(lines[0]?.line).not.toContain("eyJ");
  });

  test("maps 4xx request logs to warn and omits unknown account providers", () => {
    expect(
      buildObservabilityLogLine({
        kind: "request",
        route: "GET /api/session",
        status: 401,
        errorCode: "UNAUTHENTICATED",
        accountProvider: "cdp-embedded",
      }).level,
    ).toBe("warn");
    expect(
      readLoggedAccountProvider(
        new Request("http://127.0.0.1/api/session", {
          headers: { "X-Home-Account-Provider": "cdp-embedded" },
        }),
      ),
    ).toBe("cdp-embedded");
    expect(
      readLoggedAccountProvider(
        new Request("http://127.0.0.1/api/session", {
          headers: { "X-Home-Account-Provider": "attacker" },
        }),
      ),
    ).toBeUndefined();
    expect(
      readLoggedAccountProvider(new Request("http://127.0.0.1/api/session")),
    ).toBeUndefined();
  });
});
