import { afterEach, describe, expect, test } from "bun:test";
import { setObservabilityLogWriterForTests } from "./log";
import {
  buildUnhandledServerErrorEvent,
  handleRequestError,
} from "./on-request-error";

afterEach(() => setObservabilityLogWriterForTests());

describe("Next onRequestError ownership", () => {
  test("ignores raw request URL, headers, exception message, stack, digest, and provider payload", async () => {
    const writes: string[] = [];
    setObservabilityLogWriterForTests((line) => writes.push(line));

    const error = Object.assign(
      new Error("provider payload authorization=raw-access-value"),
      { digest: "private-digest", provider: { accessToken: "raw-provider-token" } },
    );

    await handleRequestError(
      error,
      {
        method: "POST",
        path: "/api/session?token=query-secret#hash-secret",
        headers: {
          authorization: "Bearer raw-access-value",
          cookie: "session=cookie-value",
        },
      },
      { routePath: "/app/api/session/route", routeType: "route" },
    );

    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0] ?? "{}")).toMatchObject({
      kind: "unhandled-server-error",
      route: "/app/api/session/route",
      method: "POST",
      code: "UNHANDLED_SERVER_ERROR",
      errorName: "Error",
      routeType: "route",
    });
    for (const forbidden of [
      "raw-access-value",
      "raw-provider-token",
      "cookie-value",
      "query-secret",
      "hash-secret",
      "private-digest",
      "provider payload",
      "authorization",
      "cookie",
    ]) {
      expect(writes[0]).not.toContain(forbidden);
    }
  });

  test("does not inspect hostile exception getters", () => {
    const hostile = Object.create(Error.prototype, {
      name: { get: () => { throw new Error("hostile name"); } },
      message: { get: () => { throw new Error("hostile message"); } },
      stack: { get: () => { throw new Error("hostile stack"); } },
    });

    expect(
      buildUnhandledServerErrorEvent(
        hostile,
        { method: "GET", path: "/private?x=y", headers: {} },
        { routePath: "/app/private/page", routeType: "render" },
      ),
    ).toEqual({
      kind: "unhandled-server-error",
      route: "/app/private/page",
      method: "GET",
      errorName: "Error",
      routeType: "render",
    });
  });
});
