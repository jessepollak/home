import { describe, expect, test } from "bun:test";
import {
  CDP_SQL_ENDPOINT,
  createCdpSqlAuthFromEnv,
  createCdpSqlHttpTransport,
  parseCdpSqlResponseEnvelope,
} from "./cdp-sql-client";
import { ChainDataError } from "./errors";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function successResponse() {
  return new Response(
    JSON.stringify({
      result: [],
      schema: { columns: [] },
      metadata: {
        cached: false,
        executionTimestamp: "2026-09-07T12:00:00.000Z",
        executionTimeMs: 1,
        rowCount: 0,
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("CDP SQL HTTP transport", () => {
  test("accepts the live response shape without schema and validates known fields", async () => {
    const syntheticLiveRow = {
      action: "[SYNTHETIC_UNVERIFIED_ACTION]",
      address: "0x0000000000000000000000000000000000000001",
      block_hash: `0x${"1".repeat(64)}`,
      block_number: "12345678",
      block_timestamp: "2026-09-07 11:59:00.000",
      event_name: "SyntheticEvent",
      event_signature: "SyntheticEvent()",
      log_id: "synthetic-log-id",
      log_index: 9,
      parameter_types: {},
      parameters: {},
      topics: [],
      transaction_from: "0x0000000000000000000000000000000000000002",
      transaction_hash: `0x${"2".repeat(64)}`,
      transaction_to: "0x0000000000000000000000000000000000000003",
    };
    const transport = createCdpSqlHttpTransport({
      auth: { mode: "client-api-key", clientApiKey: "client-key-value" },
      fetch: async () =>
        new Response(
          JSON.stringify({
            metadata: {
              cached: false,
              executionTimeMs: 17,
              executionTimestamp: "2026-09-07T12:00:00.000Z",
              rowCount: 1,
            },
            result: [syntheticLiveRow],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });

    await expect(
      transport.run({ sql: "SELECT * FROM base.events LIMIT 1" }),
    ).resolves.toEqual({
      metadata: {
        cached: false,
        executionTimeMs: 17,
        executionTimestamp: "2026-09-07T12:00:00.000Z",
        rowCount: 1,
      },
      result: [syntheticLiveRow],
    });
  });

  test("uses only the fixed endpoint, bounded request body, and client bearer key", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return successResponse();
    };
    const transport = createCdpSqlHttpTransport({
      auth: { mode: "client-api-key", clientApiKey: "client-key-value" },
      fetch: mockFetch,
    });

    await transport.run({ sql: "SELECT 1", cache: { maxAgeMs: 1000 } });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe(CDP_SQL_ENDPOINT);
    expect(calls[0]?.init?.method).toBe("POST");
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get(["author", "ization"].join(""))).toBe(
      ["Bear", "er client-key-value"].join(""),
    );
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      sql: "SELECT 1",
      cache: { maxAgeMs: 1000 },
    });
  });

  test("requests a signed JWT for the exact documented HTTP target", async () => {
    let requestedTarget: unknown;
    const transport = createCdpSqlHttpTransport({
      auth: {
        mode: "signed-jwt",
        async generateBearerToken(target) {
          requestedTarget = target;
          return "short-lived-jwt";
        },
      },
      fetch: async () => successResponse(),
    });

    await transport.run({ sql: "SELECT 1" });

    expect(requestedTarget).toEqual({
      requestMethod: "POST",
      requestHost: "api.cdp.coinbase.com",
      requestPath: "/platform/v2/data/query/run",
    });
  });

  test("redacts signed-token generator failures", async () => {
    const tokenMarker = ["private", "-signing-material"].join("");
    const transport = createCdpSqlHttpTransport({
      auth: {
        mode: "signed-jwt",
        async generateBearerToken() {
          throw new Error(`generator failed with ${tokenMarker}`);
        },
      },
      fetch: async () => successResponse(),
    });

    try {
      await transport.run({ sql: "SELECT 1" });
      throw new Error("Expected request to fail");
    } catch (error) {
      expect(error).toMatchObject({ code: "not-configured" });
      expect(String(error)).not.toContain(tokenMarker);
    }
  });

  test("returns a typed 429 without retrying", async () => {
    let callCount = 0;
    const transport = createCdpSqlHttpTransport({
      auth: { mode: "client-api-key", clientApiKey: "do-not-print" },
      fetch: async () => {
        callCount += 1;
        return new Response("private upstream details", {
          status: 429,
          headers: { "retry-after": "7" },
        });
      },
    });

    try {
      await transport.run({ sql: "SELECT 1" });
      throw new Error("Expected request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ChainDataError);
      expect(error).toMatchObject({
        code: "rate-limited",
        status: 429,
        retryAfterMs: 7000,
      });
      expect(String(error)).not.toContain("do-not-print");
      expect(String(error)).not.toContain("private upstream details");
    }
    expect(callCount).toBe(1);
  });

  test("does not dispatch when the caller signal is already aborted", async () => {
    let callCount = 0;
    const controller = new AbortController();
    controller.abort("superseded");
    const transport = createCdpSqlHttpTransport({
      auth: { mode: "client-api-key", clientApiKey: "client-key-value" },
      fetch: async () => {
        callCount += 1;
        return successResponse();
      },
    });

    await expect(
      transport.run({ sql: "SELECT 1", signal: controller.signal }),
    ).rejects.toMatchObject({ code: "timed-out" });
    expect(callCount).toBe(0);
  });

  test("does not dispatch when cancellation arrives during bearer generation", async () => {
    const bearer = deferred<string>();
    let callCount = 0;
    const controller = new AbortController();
    const transport = createCdpSqlHttpTransport({
      auth: {
        mode: "signed-jwt",
        generateBearerToken: async () => bearer.promise,
      },
      fetch: async () => {
        callCount += 1;
        return successResponse();
      },
    });

    const request = transport.run({
      sql: "SELECT 1",
      signal: controller.signal,
    });
    controller.abort("superseded");
    bearer.resolve("short-lived-jwt");

    await expect(request).rejects.toMatchObject({ code: "timed-out" });
    expect(callCount).toBe(0);
  });

  test("applies a finite local timeout and does not expose credentials", async () => {
    const tokenMarker = ["sensitive", "-marker"].join("");
    const transport = createCdpSqlHttpTransport({
      auth: { mode: "client-api-key", clientApiKey: tokenMarker },
      timeoutMs: 5,
      fetch: (_: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    });

    try {
      await transport.run({ sql: "SELECT 1" });
      throw new Error("Expected timeout");
    } catch (error) {
      expect(error).toMatchObject({ code: "timed-out" });
      expect(String(error)).not.toContain(tokenMarker);
    }
  });

  test("rejects malformed envelopes and oversized SQL", async () => {
    const malformedPayloads = [
      {},
      { metadata: { rowCount: 0 } },
      {
        errorType: "invalid_sql",
        errorMessage: "syntax error",
      },
      {
        result: [],
        metadata: {
          cached: "false",
          executionTimestamp: "2026-09-07T12:00:00.000Z",
          executionTimeMs: 1,
          rowCount: 0,
        },
      },
      {
        result: [],
        metadata: {
          cached: false,
          executionTimestamp: "not-a-date",
          executionTimeMs: 1,
          rowCount: 0,
        },
      },
      {
        result: [],
        metadata: {
          cached: false,
          executionTimestamp: "2026-09-07T12:00:00.000Z",
          executionTimeMs: 1,
          rowCount: 1,
        },
      },
    ];
    for (const payload of malformedPayloads) {
      const malformed = createCdpSqlHttpTransport({
        auth: { mode: "client-api-key", clientApiKey: "key" },
        fetch: async () =>
          new Response(JSON.stringify(payload), { status: 200 }),
      });
      await expect(malformed.run({ sql: "SELECT 1" })).rejects.toMatchObject({
        code: "invalid-response",
      });
    }

    const unusedFetch = createCdpSqlHttpTransport({
      auth: { mode: "client-api-key", clientApiKey: "key" },
      fetch: async () => successResponse(),
    });
    await expect(
      unusedFetch.run({ sql: "x".repeat(10_001) }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    await expect(
      unusedFetch.run({ sql: "SELECT 1", cache: { maxAgeMs: 1 } }),
    ).rejects.toMatchObject({ code: "invalid-input" });
  });

  test("accepts the official optional OnchainDataResult / x402 empty page", async () => {
    const receivedAt = new Date("2026-09-09T05:07:00.000Z");
    const transport = createCdpSqlHttpTransport({
      auth: { mode: "client-api-key", clientApiKey: "client-key-value" },
      fetch: async () =>
        new Response(JSON.stringify(LIVE_CDP_SQL_EMPTY_ENVELOPE), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    await expect(transport.run({ sql: "SELECT 1" })).resolves.toEqual({
      result: [],
      metadata: {
        cached: false,
        executionTimestamp: expect.any(String),
        executionTimeMs: 0,
        rowCount: 0,
      },
    });
    expect(
      parseCdpSqlResponseEnvelope(LIVE_CDP_SQL_EMPTY_ENVELOPE, receivedAt),
    ).toEqual({
      result: [],
      metadata: {
        cached: false,
        executionTimestamp: receivedAt.toISOString(),
        executionTimeMs: 0,
        rowCount: 0,
      },
    });
  });
});

/** Live CDP SQL / x402 200: result[] plus optional metadata (SDK OnchainDataResult). */
const LIVE_CDP_SQL_EMPTY_ENVELOPE = {
  result: [] as unknown[],
  metadata: { rowCount: 0 },
};

/** Live CoinbaSeQL 200 empty page after #98: result is null, not []. */
const LIVE_CDP_SQL_NULL_RESULT_EMPTY = {
  result: null,
  metadata: {
    cached: false,
    executionTimeMs: 362,
    executionTimestamp: "2026-09-09T14:00:00.000Z",
    rowCount: 0,
  },
};

const LIVE_CDP_SQL_X402_PAGE = {
  metadata: { rowCount: 1 },
  result: [
    {
      event_signature: "Transfer(address,address,uint256)",
      from: "0x1234567890abcdef",
      to: "0x1234567890abcdef",
      amount: 1000000000000000000,
    },
  ],
};

describe("parseCdpSqlResponseEnvelope", () => {
  const receivedAt = new Date("2026-09-09T05:07:00.000Z");

  test("normalizes optional metadata, float duration, partial schema, and truncated rowCount", () => {
    expect(
      parseCdpSqlResponseEnvelope(
        {
          result: [{ log_id: "synthetic-1" }],
          schema: {
            columns: [
              { name: "log_id", type: "String", nullable: false },
              { name: "amount" },
            ],
          },
          metadata: {
            rowCount: 10,
            executionTimeMs: 17.4,
            extra: "ignored",
          },
        },
        receivedAt,
      ),
    ).toEqual({
      result: [{ log_id: "synthetic-1" }],
      schema: { columns: [{ name: "log_id", type: "String" }] },
      metadata: {
        cached: false,
        executionTimestamp: receivedAt.toISOString(),
        executionTimeMs: 17,
        rowCount: 1,
      },
    });

    expect(parseCdpSqlResponseEnvelope(LIVE_CDP_SQL_X402_PAGE, receivedAt)).toEqual({
      result: LIVE_CDP_SQL_X402_PAGE.result,
      metadata: {
        cached: false,
        executionTimestamp: receivedAt.toISOString(),
        executionTimeMs: 0,
        rowCount: 1,
      },
    });
  });

  test("does not invent an empty page when result is missing", () => {
    expect(parseCdpSqlResponseEnvelope({ metadata: { rowCount: 0 } })).toBeNull();
    expect(
      parseCdpSqlResponseEnvelope({
        errorType: "invalid_sql",
        errorMessage: "syntax error",
      }),
    ).toBeNull();
    expect(parseCdpSqlResponseEnvelope(null)).toBeNull();
    expect(parseCdpSqlResponseEnvelope({ result: null })).toBeNull();
    expect(
      parseCdpSqlResponseEnvelope({
        result: null,
        metadata: { rowCount: 5 },
      }),
    ).toBeNull();
  });

  test("live CoinbaSeQL empty page result:null + rowCount 0 is []", () => {
    expect(
      parseCdpSqlResponseEnvelope(LIVE_CDP_SQL_NULL_RESULT_EMPTY, receivedAt),
    ).toEqual({
      result: [],
      metadata: {
        cached: false,
        executionTimestamp: "2026-09-09T14:00:00.000Z",
        executionTimeMs: 362,
        rowCount: 0,
      },
    });
    expect(
      parseCdpSqlResponseEnvelope(
        { result: null, metadata: { rowCount: 0 } },
        receivedAt,
      ),
    ).toEqual({
      result: [],
      metadata: {
        cached: false,
        executionTimestamp: receivedAt.toISOString(),
        executionTimeMs: 0,
        rowCount: 0,
      },
    });
  });
});

describe("CDP SQL environment auth", () => {
  test("defaults to only the dedicated server-side SQL client key", () => {
    const sqlKeyName = ["CDP_SQL_CLIENT", "_API_KEY"].join("");
    const generalKeyName = ["CDP_API_KEY", "_SECRET"].join("");
    expect(createCdpSqlAuthFromEnv({ [sqlKeyName]: "sql-client-value" })).toEqual({
      mode: "client-api-key",
      clientApiKey: "sql-client-value",
    });
    expect(() =>
      createCdpSqlAuthFromEnv({
        CDP_API_KEY_ID: "project-key-id",
        [generalKeyName]: "project-key-value",
      }),
    ).toThrow("CDP_SQL_CLIENT_API_KEY");
  });

  test("enables project-key signed JWT auth only when explicitly selected", () => {
    const generalKeyName = ["CDP_API_KEY", "_SECRET"].join("");
    const auth = createCdpSqlAuthFromEnv({
      CDP_SQL_AUTH_MODE: "signed-jwt",
      CDP_API_KEY_ID: "synthetic-project-key-id",
      [generalKeyName]: "synthetic-project-key-value",
    });

    expect(auth.mode).toBe("signed-jwt");
    if (auth.mode === "signed-jwt") {
      expect(typeof auth.generateBearerToken).toBe("function");
    }
    expect(() =>
      createCdpSqlAuthFromEnv({
        CDP_SQL_AUTH_MODE: "signed-jwt",
        CDP_API_KEY_ID: "synthetic-project-key-id",
      }),
    ).toThrow("CDP_API_KEY_ID and CDP_API_KEY_SECRET");
    expect(() =>
      createCdpSqlAuthFromEnv({
        CDP_SQL_AUTH_MODE: "automatic",
        CDP_SQL_CLIENT_API_KEY: "sql-client-value",
      }),
    ).toThrow("CDP_SQL_AUTH_MODE");
  });
});
