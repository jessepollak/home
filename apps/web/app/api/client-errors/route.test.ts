import { describe, expect, test } from "bun:test";
import {
  POST,
  createClientErrorHandler,
  dynamic,
  parseClientErrorReport,
  runtime,
} from "./route";
import type { ObservabilityEvent } from "@/server/observability/log";

describe("POST /api/client-errors", () => {
  test("uses the Node runtime, stays dynamic, and rejects unauthenticated-looking secret payloads", async () => {
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");
    expect(
      parseClientErrorReport({
        name: "Error",
        message: "boom",
        route: "/x",
        authorization: "Bearer secret",
      }),
    ).toBeNull();

    const response = await POST(
      new Request("http://127.0.0.1/api/client-errors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Error",
          message: "boom",
          route: "/x",
          authorization: "Bearer secret",
        }),
      }),
    );
    expect(response.status).toBe(400);
  });

  test("logs a scrubbed client exception and returns 204", async () => {
    const events: ObservabilityEvent[] = [];
    const handler = createClientErrorHandler({
      log: (event) => {
        events.push(event);
      },
    });

    const response = await handler(
      new Request("http://127.0.0.1/api/client-errors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "TypeError",
          message: "otp=123456 failed",
          route: "/activity?token=nope",
        }),
      }),
    );

    expect(response.status).toBe(204);
    expect(events).toEqual([
      {
        kind: "client-error",
        route: "/activity",
        errorCode: "CLIENT_EXCEPTION",
        name: "TypeError",
        message: "otp=[REDACTED] failed",
      },
    ]);
  });
});
