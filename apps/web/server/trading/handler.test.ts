import { describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { createTradeFinalizeHandler, createTradeHandler } from "./handler";
import { TradePreparationError } from "./prepare";
import { TradeRuntimeCapabilityError } from "./runtime-intent-store";

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;

function session(accountProvider: VerifiedAccountSession["accountProvider"]): VerifiedAccountSession {
  return {
    user: { subject: "trade-user" },
    smartAccount: { address: ADDRESS, chainId: 8453 },
    accountProvider,
  };
}

function authorize(accountProvider: VerifiedAccountSession["accountProvider"]) {
  return async () => Response.json(session(accountProvider));
}

function tradeRequest(provider: VerifiedAccountSession["accountProvider"]) {
  const body = JSON.stringify({
    assetId: "cbbtc",
    side: "buy",
    amountBaseUnits: "1000000",
    slippageBps: 100,
  });
  return jsonRequest("https://home.test/api/trades", provider, body);
}

function finalizeRequest(provider: VerifiedAccountSession["accountProvider"]) {
  const body = JSON.stringify({
    intentHash: "a".repeat(64),
    signature: `0x${"b".repeat(130)}`,
  });
  return jsonRequest("https://home.test/api/trades/11111111-1111-4111-8111-111111111111/finalize", provider, body);
}

function jsonRequest(
  url: string,
  provider: VerifiedAccountSession["accountProvider"],
  body: string,
): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      authorization: "Bearer aaa.bbb.ccc",
      "content-type": "application/json",
      "content-length": String(body.length),
      "X-Home-Account-Provider": provider,
    },
    body,
  });
}

describe("trade session handler", () => {
  test("accepts a verified Base Account session and reaches prepare", async () => {
    let preparedProvider: string | undefined;
    const handler = createTradeHandler({
      authorize: authorize("base-account"),
      prepare: async ({ session: verified }) => {
        preparedProvider = verified.accountProvider;
        throw new TradePreparationError("insufficient-balance");
      },
    });
    const response = await handler(tradeRequest("base-account"));
    expect(preparedProvider).toBe("base-account");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "unavailable",
      reason: "insufficient-balance",
    });
  });

  test("still prepares an email CDP session", async () => {
    let preparedProvider: string | undefined;
    const handler = createTradeHandler({
      authorize: authorize("cdp-embedded"),
      prepare: async ({ session: verified }) => {
        preparedProvider = verified.accountProvider;
        throw new TradePreparationError("insufficient-balance");
      },
    });
    const response = await handler(tradeRequest("cdp-embedded"));
    expect(preparedProvider).toBe("cdp-embedded");
    expect(response.status).toBe(200);
  });

  test("returns the typed hosted swap capability without masking it as a provider failure", async () => {
    const handler = createTradeHandler({
      authorize: authorize("cdp-embedded"),
      prepare: async () => { throw new TradeRuntimeCapabilityError(); },
    });
    const response = await handler(tradeRequest("cdp-embedded"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "HOSTED_SWAP_UNAVAILABLE",
        message: "Hosted swap execution is unavailable until trade intents and executable payload handoff are durable.",
      },
    });
  });

  test("returns the same typed capability from hosted finalization", async () => {
    const handler = createTradeFinalizeHandler({
      authorize: authorize("cdp-embedded"),
      finalize: async () => { throw new TradeRuntimeCapabilityError(); },
    });
    const response = await handler(
      finalizeRequest("cdp-embedded"),
      { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "HOSTED_SWAP_UNAVAILABLE" },
    });
  });

  test("preserves authorization errors before evaluating hosted swap capability", async () => {
    let prepareCalls = 0;
    const handler = createTradeHandler({
      authorize: async () => Response.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 }),
      prepare: async () => {
        prepareCalls += 1;
        throw new TradeRuntimeCapabilityError();
      },
    });
    const response = await handler(tradeRequest("cdp-embedded"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "UNAUTHENTICATED" } });
    expect(prepareCalls).toBe(0);
  });
});
