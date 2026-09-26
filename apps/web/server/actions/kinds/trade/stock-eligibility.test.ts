import { describe, expect, test } from "bun:test";
import { stockAssets } from "@/config/invest-assets";
import { BASE_USDC_ADDRESS } from "@/shared/money-actions/network-fee";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { TradePreparationError } from "./permit2";
import { assertStockTradeConfirmAllowed, assertStockTradePrepareAllowed, createStockTradeEligibilityHandler, readTrustedEdgeCountry, stockTradeDecision } from "./stock-eligibility";

const stock = stockAssets[0];
const btc = "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf";
const request = (country: string | null) => new Request("https://home.test/api/trades/stock-eligibility", { headers: country ? { "x-vercel-ip-country": country } : {} });
const metadata = (direction: "buy" | "sell") => ({
  fromAsset: { address: direction === "buy" ? BASE_USDC_ADDRESS : stock.contractAddress },
  toAsset: { address: direction === "buy" ? stock.contractAddress : BASE_USDC_ADDRESS },
});
const session: VerifiedAccountSession = { user: { subject: "test-owner" }, smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 }, accountProvider: "base-account" };

describe("stock trade edge guard", () => {
  test.each(["DE", "US", "PR", null, "XX"] as const)("guards both stages by trusted country %s", (country) => {
    for (const trusted of [true, false]) {
      const env = trusted ? { VERCEL: "1" } : {};
      for (const direction of ["buy", "sell"] as const) {
        const allowed = direction === "sell" || (country === "DE" && trusted);
        const input = { request: request(country), env };
        const prepare = () => assertStockTradePrepareAllowed({ ...input, params: { assetId: stock.id, direction } });
        if (allowed) expect(prepare).not.toThrow();
        else expect(prepare).toThrow(TradePreparationError);
        expect(assertStockTradeConfirmAllowed({ ...input, metadata: metadata(direction) })).toBe(allowed);
      }
    }
  });
  test("ignores client fields, untrusted headers, and country preferences", () => {
    expect(readTrustedEdgeCountry(request("DE"), {})).toBeNull();
    expect(() => assertStockTradePrepareAllowed({ request: request("US"), env: { VERCEL: "1" }, params: { assetId: stock.id, direction: "buy", country: "DE", countryPreference: "DE" } })).toThrow(TradePreparationError);
    expect(() => assertStockTradePrepareAllowed({ request: request("DE"), env: {}, params: { assetId: stock.id, direction: "buy" } })).toThrow(TradePreparationError);
    expect(readTrustedEdgeCountry(request("DE"), { HOME_TRUST_EDGE_COUNTRY_HEADER: "true" })).toBe("DE");
    expect(readTrustedEdgeCountry(request("DE"), { HOME_TRUST_EDGE_COUNTRY_HEADER: "TRUE" })).toBeNull();
  });
  test("refuses malformed stock metadata and stock to non-USDC; leaves nonstock trades alone", () => {
    const input = { request: request("DE"), env: { VERCEL: "1" } };
    expect(assertStockTradeConfirmAllowed({ ...input, metadata: { fromAsset: { address: stock.contractAddress }, toAsset: {} } })).toBe(false);
    expect(assertStockTradeConfirmAllowed({ ...input, metadata: { fromAsset: { id: stock.id }, toAsset: { address: BASE_USDC_ADDRESS } } })).toBe(false);
    expect(assertStockTradeConfirmAllowed({ ...input, metadata: { fromAsset: { address: BASE_USDC_ADDRESS }, toAsset: { id: stock.id, address: btc } } })).toBe(false);
    expect(assertStockTradeConfirmAllowed({ ...input, metadata: { fromAsset: { id: stock.id, address: BASE_USDC_ADDRESS }, toAsset: { address: btc } } })).toBe(false);
    expect(assertStockTradeConfirmAllowed({ ...input, metadata: { fromAsset: { address: BASE_USDC_ADDRESS }, toAsset: { id: "cbbtc", address: stock.contractAddress } } })).toBe(false);
    expect(stockTradeDecision({ fromAsset: stock.contractAddress, toAsset: btc, country: "DE" })).toBe(false);
    expect(stockTradeDecision({ fromAsset: btc, toAsset: stock.contractAddress, country: "DE" })).toBe(false);
    expect(stockTradeDecision({ fromAsset: BASE_USDC_ADDRESS.toUpperCase().replace("0X", "0x"), toAsset: stock.contractAddress, country: "DE" })).toBe(true);
    expect(stockTradeDecision({ fromAsset: BASE_USDC_ADDRESS, toAsset: btc, country: null })).toBe(true);
    expect(assertStockTradeConfirmAllowed({ ...input, metadata: {} })).toBe(true);
    expect(() => assertStockTradePrepareAllowed({ ...input, params: { assetId: "cbbtc", direction: "buy" } })).not.toThrow();
  });
  test.each([
    ["DE", { VERCEL: "1" }, "eligible"], ["US", { VERCEL: "1" }, "restricted"],
    [null, { VERCEL: "1" }, "restricted"], ["DE", {}, "restricted"],
  ] as const)("returns private status for %s", async (country, env, buy) => {
    const response = await createStockTradeEligibilityHandler({ authorize: async () => session, env })(request(country));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("private, no-store");
    expect(await response.json()).toEqual({ version: 1, buy, sell: "eligible" });
  });
  test("preserves authorization denial", async () => {
    const response = await createStockTradeEligibilityHandler({ authorize: async () => Response.json({ error: { code: "AUTH_REQUIRED" } }, { status: 401 }) })(request("DE"));
    expect(response.status).toBe(401);
  });
});
