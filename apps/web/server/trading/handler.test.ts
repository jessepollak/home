import { describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/features/account/session-types";
import { createTradeHandler } from "./handler";
import { TradePreparationError } from "./prepare";

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
  return new Request("https://home.test/api/trades", {
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
});
