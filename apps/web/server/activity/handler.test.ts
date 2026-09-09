import { describe, expect, test } from "bun:test";
import { activityAssets, type ActivityPage } from "@/features/activity/types";
import { createBaseErc20TransferHistory } from "@/server/chain-data/base-erc20-transfers";
import { createCdpSqlHttpTransport } from "@/server/chain-data/cdp-sql-client";
import { ChainDataError } from "@/server/chain-data/errors";
import { createActivityHandler } from "./handler";
import { createActivityReader } from "./reader";

const VERIFIED = "0x1111111111111111111111111111111111111111" as const;
const ATTACKER = "0x9999999999999999999999999999999999999999";
const TO = "2026-09-07T12:00:00.000Z";

function sessionResponse(
  address: string = VERIFIED,
  accountProvider: "cdp-embedded" | "base-account" = "cdp-embedded",
) {
  return Response.json({
    user: { subject: "subject-a" },
    smartAccount: { address, chainId: 8453 },
    accountProvider,
  });
}

function page(): ActivityPage {
  return {
    walletAddress: VERIFIED,
    chainId: 8453,
    window: { from: "2026-08-07T12:00:00.000Z", to: TO },
    transfers: [],
    nextCursor: null,
    source: {
      provider: "cdp-sql",
      cached: false,
      stale: false,
      executionTimestamp: TO,
      executionTimeMs: 1,
      fetchedAt: TO,
    },
  };
}

function expectPrivate(response: Response) {
  expect(response.headers.get("cache-control")).toBe(
    "private, no-store, max-age=0",
  );
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("vary")).toBe(
    "Authorization, X-Home-Account-Provider",
  );
}

describe("activity route handler", () => {
  test("derives wallet scope only from the verified session and forwards the stable window", async () => {
    let received: unknown;
    const handler = createActivityHandler({
      authorize: async () => sessionResponse(),
      readActivity: async (account, request, signal) => {
        received = { account, request, signal };
        return page();
      },
      now: () => new Date(TO),
    });
    const request = new Request(
      `http://localhost/api/activity?to=${encodeURIComponent(TO)}&cursor=next`,
    );
    const response = await handler(request);

    expect(response.status).toBe(200);
    expectPrivate(response);
    expect(received).toEqual({
      account: {
        address: VERIFIED,
        chainId: 8453,
        verification: "session-smart-account",
      },
      request: { to: TO, cursor: "next" },
      signal: request.signal,
    });
  });

  test("rejects browser wallet scope and unknown query inputs without calling chain data", async () => {
    for (const query of [
      `to=${encodeURIComponent(TO)}&wallet=${ATTACKER}`,
      `to=${encodeURIComponent(TO)}&to=${encodeURIComponent(TO)}`,
      "to=not-a-date",
    ]) {
      let calls = 0;
      const handler = createActivityHandler({
        authorize: async () => sessionResponse(),
        readActivity: async () => {
          calls += 1;
          return page();
        },
        now: () => new Date(TO),
      });
      const response = await handler(
        new Request(`http://localhost/api/activity?${query}`),
      );
      expect(response.status).toBe(400);
      expectPrivate(response);
      expect(calls).toBe(0);
    }
  });

  test("relays authorization failures and fails closed for malformed sessions", async () => {
    const boundaryFailure = Response.json(
      { error: { code: "UNAUTHENTICATED" } },
      {
        status: 401,
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          Pragma: "no-cache",
          Vary: "Authorization, X-Home-Account-Provider",
        },
      },
    );
    const unauthorized = createActivityHandler({
      authorize: async () => boundaryFailure,
      readActivity: async () => page(),
    });
    expect(
      await unauthorized(
        new Request(`http://localhost/api/activity?to=${encodeURIComponent(TO)}`),
      ),
    ).toBe(boundaryFailure);

    const malformed = createActivityHandler({
      authorize: async () => sessionResponse(ATTACKER.slice(0, -1)),
      readActivity: async () => page(),
    });
    const response = await malformed(
      new Request(`http://localhost/api/activity?to=${encodeURIComponent(TO)}`),
    );
    expect(response.status).toBe(503);
    expectPrivate(response);
  });

  test("preserves the useful not-configured response without inventing empty history", async () => {
    const handler = createActivityHandler({
      authorize: async () => sessionResponse(),
      readActivity: async () => {
        throw new ChainDataError("not-configured", "fixture");
      },
      now: () => new Date(TO),
    });
    const response = await handler(
      new Request(`http://localhost/api/activity?to=${encodeURIComponent(TO)}`),
    );
    expect(response.status).toBe(503);
    expectPrivate(response);
    expect(await response.json()).toEqual({
      error: {
        code: "ACTIVITY_NOT_CONFIGURED",
        message: "CDP SQL activity is not configured. Set CDP_SQL_AUTH_MODE and its required server credentials.",
      },
    });
  });

  test("scopes Base Account activity to the verified SIWE session address", async () => {
    let received: unknown;
    const handler = createActivityHandler({
      authorize: async () => sessionResponse(VERIFIED, "base-account"),
      readActivity: async (account, request) => {
        received = { account, request };
        return page();
      },
      now: () => new Date(TO),
    });
    const response = await handler(
      new Request(`http://localhost/api/activity?to=${encodeURIComponent(TO)}`, {
        headers: { "X-Home-Account-Provider": "base-account" },
      }),
    );

    expect(response.status).toBe(200);
    expectPrivate(response);
    expect(received).toEqual({
      account: {
        address: VERIFIED,
        chainId: 8453,
        verification: "session-smart-account",
      },
      request: { to: TO, cursor: null },
    });
  });

  test("rejects a successful session whose provider disagrees with the request selector", async () => {
    let calls = 0;
    const handler = createActivityHandler({
      authorize: async () => sessionResponse(VERIFIED, "cdp-embedded"),
      readActivity: async () => {
        calls += 1;
        return page();
      },
      now: () => new Date(TO),
    });
    const response = await handler(
      new Request(`http://localhost/api/activity?to=${encodeURIComponent(TO)}`, {
        headers: { "X-Home-Account-Provider": "base-account" },
      }),
    );
    expect(response.status).toBe(503);
    expectPrivate(response);
    expect(await response.json()).toEqual({
      error: {
        code: "AUTH_UNAVAILABLE",
        message: "Authentication is temporarily unavailable.",
      },
    });
    expect(calls).toBe(0);
  });

  test("surfaces timeout and rate-limit codes instead of a generic unavailable body", async () => {
    const timeout = createActivityHandler({
      authorize: async () => sessionResponse(),
      readActivity: async () => {
        throw new ChainDataError("timed-out", "fixture");
      },
      now: () => new Date(TO),
    });
    const timeoutResponse = await timeout(
      new Request(`http://localhost/api/activity?to=${encodeURIComponent(TO)}`),
    );
    expect(timeoutResponse.status).toBe(504);
    expect(await timeoutResponse.json()).toEqual({
      error: {
        code: "ACTIVITY_TIMEOUT",
        message: "Recent Base activity timed out. Try again.",
      },
    });

    const limited = createActivityHandler({
      authorize: async () => sessionResponse(),
      readActivity: async () => {
        throw new ChainDataError("rate-limited", "fixture");
      },
      now: () => new Date(TO),
    });
    const limitedResponse = await limited(
      new Request(`http://localhost/api/activity?to=${encodeURIComponent(TO)}`),
    );
    expect(limitedResponse.status).toBe(429);
    expect(await limitedResponse.json()).toEqual({
      error: {
        code: "ACTIVITY_RATE_LIMITED",
        message: "Activity is rate limited. Try again shortly.",
      },
    });
  });

  test("live slim CDP empty envelope is 200 [] not ACTIVITY_INVALID_RESPONSE", async () => {
    const history = createBaseErc20TransferHistory({
      assets: activityAssets.map((asset) => ({
        id: asset.id,
        chainId: 8453,
        address: asset.tokenAddress,
      })),
      transport: createCdpSqlHttpTransport({
        auth: { mode: "client-api-key", clientApiKey: "client-key-value" },
        fetch: async () =>
          new Response(
            JSON.stringify({ result: [], metadata: { rowCount: 0 } }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      }),
      now: () => new Date(TO),
    });
    const handler = createActivityHandler({
      authorize: async () => sessionResponse(),
      readActivity: createActivityReader((input) => history.listTransfers(input)),
      now: () => new Date(TO),
    });
    const response = await handler(
      new Request(`http://localhost/api/activity?to=${encodeURIComponent(TO)}`),
    );
    expect(response.status).toBe(200);
    expectPrivate(response);
    const body = (await response.json()) as { transfers: unknown[]; error?: unknown };
    expect(body.error).toBeUndefined();
    expect(body.transfers).toEqual([]);
  });

  test("healthy session with empty CDP history is an empty page, not ACTIVITY_UNAVAILABLE", async () => {
    let sql = "";
    const history = createBaseErc20TransferHistory({
      assets: activityAssets.map((asset) => ({
        id: asset.id,
        chainId: 8453,
        address: asset.tokenAddress,
      })),
      transport: {
        async run(request) {
          sql = request.sql;
          return {
            result: [],
            metadata: {
              cached: false,
              executionTimestamp: TO,
              executionTimeMs: 4,
              rowCount: 0,
            },
          };
        },
      },
      now: () => new Date(TO),
    });
    const handler = createActivityHandler({
      authorize: async () => sessionResponse(),
      readActivity: createActivityReader((input) => history.listTransfers(input)),
      now: () => new Date(TO),
    });
    const response = await handler(
      new Request(`http://localhost/api/activity?to=${encodeURIComponent(TO)}`),
    );
    expect(response.status).toBe(200);
    expectPrivate(response);
    const body = (await response.json()) as { transfers: unknown[]; error?: unknown };
    expect(body.error).toBeUndefined();
    expect(body.transfers).toEqual([]);
    expect(sql).toContain("sum(toInt8(action)) AS net_action");
    expect(sql).toContain("WHERE net_action > 0");
    expect(sql).not.toMatch(/\bHAVING\b/);
    expect(sql).not.toMatch(/GROUP BY log_id[\s\S]*LIMIT 10000/);
  });

  test("maps CDP SQL provider codes instead of one ACTIVITY_UNAVAILABLE catch-all", async () => {
    const cases = [
      {
        code: "upstream-error" as const,
        status: 502,
        body: {
          code: "ACTIVITY_UPSTREAM",
          message: "Recent Base activity could not be loaded from the data provider.",
        },
      },
      {
        code: "invalid-response" as const,
        status: 502,
        body: {
          code: "ACTIVITY_INVALID_RESPONSE",
          message: "Recent Base activity returned an unexpected response.",
        },
      },
      {
        code: "payment-required" as const,
        status: 402,
        body: {
          code: "ACTIVITY_PAYMENT_REQUIRED",
          message: "Activity history is not entitled on this project.",
        },
      },
    ];

    for (const { code, status, body } of cases) {
      const handler = createActivityHandler({
        authorize: async () => sessionResponse(),
        readActivity: async () => {
          throw new ChainDataError(code, "fixture");
        },
        now: () => new Date(TO),
      });
      const response = await handler(
        new Request(`http://localhost/api/activity?to=${encodeURIComponent(TO)}`),
      );
      expect(response.status).toBe(status);
      expectPrivate(response);
      expect(await response.json()).toEqual({ error: body });
    }
  });

  test("unknown ChainDataError codes stay on the catch-all, not a typed lie", async () => {
    const error = new ChainDataError("upstream-error", "fixture");
    Object.assign(error, { code: "schema-changed" });
    const handler = createActivityHandler({
      authorize: async () => sessionResponse(),
      readActivity: async () => {
        throw error;
      },
      now: () => new Date(TO),
    });
    const response = await handler(
      new Request(`http://localhost/api/activity?to=${encodeURIComponent(TO)}`),
    );
    expect(response.status).toBe(502);
    expectPrivate(response);
    expect(await response.json()).toEqual({
      error: {
        code: "ACTIVITY_UNAVAILABLE",
        message: "Recent Base activity is temporarily unavailable.",
      },
    });
  });

  test("never turns provider failure into empty history", async () => {
    const handler = createActivityHandler({
      authorize: async () => sessionResponse(),
      readActivity: async () => {
        throw new Error("private provider detail");
      },
      now: () => new Date(TO),
    });
    const response = await handler(
      new Request(`http://localhost/api/activity?to=${encodeURIComponent(TO)}`),
    );
    expect(response.status).toBe(502);
    expectPrivate(response);
    expect(await response.json()).toEqual({
      error: {
        code: "ACTIVITY_UNAVAILABLE",
        message: "Recent Base activity is temporarily unavailable.",
      },
    });
  });
});
