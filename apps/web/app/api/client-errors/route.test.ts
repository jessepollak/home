import { afterEach, describe, expect, test } from "bun:test";
import {
  CLIENT_ERROR_ENDPOINT,
  reportClientError,
} from "@/client/observability/client-reporter";
import {
  setObservabilityLogWriterForTests,
  writeObservabilityEvent,
} from "@/server/observability/log";
import type { ObservabilityEvent } from "@/server/observability/schema";
import {
  CLIENT_ERROR_MAX_BODY_BYTES,
  createClientErrorHandler,
  dynamic,
  parseClientErrorReport,
  runtime,
} from "./route";

const endpoint = "https://home.example/api/client-errors";
const safeHeaders = {
  origin: "https://home.example",
  "sec-fetch-site": "same-origin",
  "content-type": "application/json",
};

afterEach(() => setObservabilityLogWriterForTests());

function request(
  body: string | Uint8Array | ReadableStream<Uint8Array>,
  headerValues: Record<string, string> = safeHeaders,
): Request {
  const normalizedHeaders = new Map(
    Object.entries(headerValues).map(([key, value]) => [key.toLowerCase(), value]),
  );
  const stream = body instanceof ReadableStream
    ? body
    : new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(typeof body === "string" ? new TextEncoder().encode(body) : body);
          controller.close();
        },
      });

  return {
    url: endpoint,
    headers: {
      get: (name: string) => normalizedHeaders.get(name.toLowerCase()) ?? null,
      has: (name: string) => normalizedHeaders.has(name.toLowerCase()),
    },
    body: stream,
  } as Request;
}

describe("POST /api/client-errors security matrix", () => {
  test("is a dynamic Node-only endpoint", () => {
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");
  });

  test("accepts only exact, bounded schema values", () => {
    expect(parseClientErrorReport({ name: "Error", message: "boom", route: "/activity" })).toEqual({
      name: "Error",
      message: "boom",
      route: "/activity",
    });
    for (const invalid of [
      null,
      [],
      {},
      { name: "Error", message: "boom", route: "/", extra: "field" },
      { name: "Error", message: "boom", route: "https://evil.example/x" },
      { name: "Error", message: "boom", route: "//evil.example/x" },
      { name: "Error", message: "x".repeat(1_025), route: "/" },
      { name: "", message: "boom", route: "/" },
    ]) {
      expect(parseClientErrorReport(invalid)).toBeNull();
    }
  });

  test("rejects missing, null, malformed, and cross-origin requests before reading the body", async () => {
    for (const headers of [
      { "content-type": "application/json" },
      { ...safeHeaders, origin: "null" },
      { ...safeHeaders, origin: "https://evil.example" },
      { ...safeHeaders, origin: "https://home.example/" },
      { ...safeHeaders, "sec-fetch-site": "cross-site" },
    ]) {
      let pulls = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          controller.enqueue(new TextEncoder().encode('{"name":"Error"}'));
          controller.close();
        },
      });
      const response = await createClientErrorHandler({ takePermit: () => true })(
        request(body, headers),
      );
      expect(response.status).toBe(403);
      expect(pulls).toBe(0);
    }
  });

  test("rejects wrong media types and encoded bodies before allocation", async () => {
    for (const headers of [
      { ...safeHeaders, "content-type": "text/plain" },
      { ...safeHeaders, "content-type": "application/problem+json" },
      { ...safeHeaders, "content-encoding": "gzip" },
    ]) {
      const response = await createClientErrorHandler({ takePermit: () => true })(
        request("{}", headers),
      );
      expect(response.status).toBe(415);
    }
  });

  test("rejects malformed, unknown-field, non-UTF8, and oversized bodies without logging", async () => {
    const events: ObservabilityEvent[] = [];
    const handler = createClientErrorHandler({
      log: (event) => events.push(event),
      takePermit: () => true,
    });

    expect((await handler(request("{"))).status).toBe(400);
    expect(
      (await handler(request(JSON.stringify({ name: "Error", message: "boom", route: "/", token: "secret" })))).status,
    ).toBe(400);
    expect(
      (await handler(request(new Uint8Array([0xc3, 0x28])))).status,
    ).toBe(400);
    expect(
      (
        await handler(
          request("{}", {
            ...safeHeaders,
            "content-length": String(CLIENT_ERROR_MAX_BODY_BYTES + 1),
          }),
        )
      ).status,
    ).toBe(413);

    const streamed = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(CLIENT_ERROR_MAX_BODY_BYTES));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    expect((await handler(request(streamed))).status).toBe(413);
    expect(events).toEqual([]);
  });

  test("rate limits before reading or parsing and returns a bounded retry hint", async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new TextEncoder().encode("{}"));
        controller.close();
      },
    });
    const response = await createClientErrorHandler({ takePermit: () => false })(
      request(body),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(pulls).toBe(0);
  });

  test("logs only a scrubbed allowlisted event and returns 204", async () => {
    const events: ObservabilityEvent[] = [];
    const handler = createClientErrorHandler({
      log: (event) => events.push(event),
      takePermit: () => true,
    });
    const response = await handler(
      request(
        JSON.stringify({
          name: "TypeError",
          message: '{"password":"correct horse battery staple","accessToken":"raw-access-value"}',
          route: "/activity?token=query-secret#hash-secret",
        }),
      ),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(events).toEqual([
      {
        kind: "client-error",
        route: "/activity",
        errorName: "TypeError",
        summary: '{"password":"[REDACTED]","accessToken":"[REDACTED]"}',
      },
    ]);
  });

  test("log sink failures cannot change a successful ingestion response", async () => {
    const response = await createClientErrorHandler({
      log: () => { throw new Error("sink failed"); },
      takePermit: () => true,
    })(request(JSON.stringify({ name: "Error", message: "boom", route: "/" })));
    expect(response.status).toBe(204);
  });

  test("scrubs synthetic canaries from reporter through the normalized log line", async () => {
    const canaries = {
      headerOne: "e2e-header-first-canary",
      headerTwo: "e2e-header-second-canary",
      array: "e2e-array-canary",
      object: "e2e-object-canary",
      path: "e2e-path-canary",
      boundary: "e2e-boundary-canary",
    };
    const authorizationKey = ["Author", "ization"].join("");
    const accessTokenKey = ["access", "Token"].join("");
    const clientSecretKey = ["client", "Secret"].join("");
    const tokenKey = ["to", "ken"].join("");
    const prefix = [
      `${authorizationKey}: Custom ${canaries.headerOne}, Alternate ${canaries.headerTwo}`,
      JSON.stringify({
        [accessTokenKey]: [canaries.array, "e2e-array-second-canary"],
        [clientSecretKey]: { primary: canaries.object },
        safe: "safe-retained",
      }),
      `/recover/${tokenKey}/${canaries.path}`,
    ].join("\n");
    const urlPrefix = "https://example.test/";
    const longUrl = `${urlPrefix}${"a".repeat(4_070 - prefix.length - urlPrefix.length)}`;
    const message = `${prefix}\n${longUrl} ${tokenKey}="${canaries.boundary}${"z".repeat(100)}"`;
    const writes: string[] = [];
    let endpointStatus = 0;
    setObservabilityLogWriterForTests((line) => writes.push(line));

    const handler = createClientErrorHandler({
      log: writeObservabilityEvent,
      takePermit: () => true,
    });
    await reportClientError(
      {
        name: "TypeError",
        message,
        route: `/recover/access_token/${canaries.path}/done?token=query-canary`,
      },
      async (input, init) => {
        expect(input).toBe(CLIENT_ERROR_ENDPOINT);
        const body = String(init.body ?? "");
        const response = await handler(
          request(body, {
            ...safeHeaders,
            "content-length": String(new TextEncoder().encode(body).byteLength),
          }),
        );
        endpointStatus = response.status;
        return { ok: response.ok, status: response.status };
      },
    );

    expect(endpointStatus).toBe(204);
    expect(writes).toHaveLength(1);
    const line = JSON.parse(writes[0] ?? "{}") as Record<string, unknown>;
    expect(line).toMatchObject({
      schema: "home.observability.v2",
      kind: "client-error",
      route: "/recover/:redacted/:redacted/done",
      errorName: "TypeError",
    });
    expect(line.summary).toContain("safe-retained");

    const serialized = JSON.stringify(line);
    for (const canary of [
      ...Object.values(canaries),
      "e2e-array-second-canary",
      "query-canary",
    ]) {
      expect(serialized).not.toContain(canary);
    }
    expect(serialized).not.toContain(canaries.boundary.slice(0, 8));
  });

  test("scrubs recursively encoded keys in wrapped paths through the normalized log line", async () => {
    const routeCanary = "wrapped-route-canary";
    const absoluteCanary = "wrapped-absolute-canary";
    const relativeCanary = "wrapped-relative-canary";
    const writes: string[] = [];
    let endpointStatus = 0;
    setObservabilityLogWriterForTests((line) => writes.push(line));

    const handler = createClientErrorHandler({
      log: writeObservabilityEvent,
      takePermit: () => true,
    });
    await reportClientError(
      {
        name: "TypeError",
        message: `[/reset/%2574oken/${absoluteCanary}] {docs/%2574oken/${relativeCanary}}`,
        route: `/reset/%2574oken/${routeCanary}`,
      },
      async (input, init) => {
        expect(input).toBe(CLIENT_ERROR_ENDPOINT);
        const body = String(init.body ?? "");
        const response = await handler(
          request(body, {
            ...safeHeaders,
            "content-length": String(new TextEncoder().encode(body).byteLength),
          }),
        );
        endpointStatus = response.status;
        return { ok: response.ok, status: response.status };
      },
    );

    expect(endpointStatus).toBe(204);
    expect(writes).toHaveLength(1);
    const line = JSON.parse(writes[0] ?? "{}") as Record<string, unknown>;
    expect(line).toMatchObject({
      schema: "home.observability.v2",
      kind: "client-error",
      route: "/reset/:redacted/:redacted",
      errorName: "TypeError",
      summary: "[/reset/:redacted/:redacted] {docs/:redacted/:redacted}",
    });

    const serialized = JSON.stringify(line);
    for (const canary of [routeCanary, absoluteCanary, relativeCanary]) {
      expect(serialized).not.toContain(canary);
    }
  });
});
