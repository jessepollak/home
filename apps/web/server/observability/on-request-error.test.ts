import { afterEach, describe, expect, test } from "bun:test";
import { setObservabilityLogWriterForTests } from "./log";
import { handleRequestError } from "./on-request-error";

afterEach(() => {
  setObservabilityLogWriterForTests();
});

describe("onRequestError", () => {
  test("logs the route and never writes request headers or query tokens", async () => {
    const lines: string[] = [];
    setObservabilityLogWriterForTests((line) => {
      lines.push(line);
    });

    await handleRequestError(
      new Error("validateAccessToken failed for Bearer leaked.token.value"),
      {
        method: "GET",
        path: "/api/session?access_token=should-not-log",
        headers: {
          authorization: "Bearer leaked.token.value",
          cookie: "session=secret",
        },
      },
      { routePath: "/api/session", routeType: "route" },
    );

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      kind: "unhandled-server-error",
      route: "GET /api/session",
      status: 500,
      errorCode: "UNHANDLED",
      routeType: "route",
    });
    expect(lines[0]).not.toContain("leaked.token.value");
    expect(lines[0]).not.toContain("should-not-log");
    expect(lines[0]).not.toContain("authorization");
    expect(lines[0]).not.toContain("cookie");
  });
});
