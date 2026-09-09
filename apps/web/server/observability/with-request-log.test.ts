import { afterEach, describe, expect, test } from "bun:test";
import { setObservabilityLogWriterForTests } from "./log";
import { readResponseErrorCode, withRequestLog } from "./with-request-log";

afterEach(() => {
  setObservabilityLogWriterForTests();
});

describe("withRequestLog", () => {
  test("logs stable API error codes without consuming the response or leaking secrets", async () => {
    const lines: string[] = [];
    setObservabilityLogWriterForTests((line) => {
      lines.push(line);
    });

    const handler = withRequestLog(
      "GET /api/activity",
      async (request: Request) => {
        expect(request.headers.get("Authorization")).toBe(
          "Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
        );
        return Response.json(
          {
            error: {
              code: "ACTIVITY_UNAVAILABLE",
              message: "Recent Base activity is temporarily unavailable.",
            },
          },
          { status: 502 },
        );
      },
    );

    const response = await handler(
      new Request("http://127.0.0.1/api/activity", {
        headers: {
          Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
          "X-Home-Account-Provider": "base-account",
        },
      }),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: {
        code: "ACTIVITY_UNAVAILABLE",
        message: "Recent Base activity is temporarily unavailable.",
      },
    });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      schema: "home.observability.v1",
      kind: "request",
      route: "GET /api/activity",
      status: 502,
      errorCode: "ACTIVITY_UNAVAILABLE",
      accountProvider: "base-account",
      level: "error",
    });
    expect(lines[0]).not.toContain("eyJ");
    expect(lines[0]).not.toContain("Authorization");
  });

  test("does not parse successful JSON bodies and rethrows after logging unhandled failures", async () => {
    expect(
      await readResponseErrorCode(Response.json({ ok: true }, { status: 200 })),
    ).toBeUndefined();

    const lines: string[] = [];
    setObservabilityLogWriterForTests((line) => {
      lines.push(line);
    });
    const handler = withRequestLog("POST /api/actions/send/prepare", async () => {
      throw new Error("Bearer super-secret failed");
    });

    await expect(
      handler(new Request("http://127.0.0.1/api/actions/send/prepare")),
    ).rejects.toBeInstanceOf(Error);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      kind: "unhandled-server-error",
      route: "POST /api/actions/send/prepare",
      status: 500,
      errorCode: "UNHANDLED",
      message: "Bearer [REDACTED] failed",
    });
  });
});
