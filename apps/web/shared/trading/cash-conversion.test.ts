import { describe, expect, test } from "bun:test";
import { canonicalUsdcAsset, verifiedLocalCashAssets } from "@/config/portfolio-assets";
import { parseAddress } from "@/shared/chain/hex";
import type { TradeMoneyActionMetadata } from "./contract";
import { cashConversionCurrencies, cashConversionCurrency, cashConversionDestinations, cashConversionPair, cashConversionTrade } from "./cash-conversion";

const usd = cashConversionCurrencies.find((currency) => currency.code === "USD")!;
const eur = cashConversionCurrencies.find((currency) => currency.code === "EUR")!;
const idr = cashConversionCurrencies.find((currency) => currency.code === "IDR")!;
const ars = cashConversionCurrencies.find((currency) => currency.code === "ARS")!;
const brl = cashConversionCurrencies.find((currency) => currency.code === "BRL")!;
const cop = cashConversionCurrencies.find((currency) => currency.code === "COP")!;
const metadata = (from = usd, to = eur): TradeMoneyActionMetadata => ({
  product: "trade", provider: "cdp-swaps", direction: from.code === "USD" ? "buy" : "sell",
  assetId: (from.code === "USD" ? to : from).tradeAssetId, assetName: to.name,
  network: { name: "Base", chainId: 8453 },
  fromAsset: { id: from.portfolioAssetId, address: from.address, symbol: from.symbol, decimals: from.decimals },
  toAsset: { id: to.portfolioAssetId, address: to.address, symbol: to.symbol, decimals: to.decimals },
  fromAmountBaseUnits: "1000000", expectedToAmountBaseUnits: "900000", minimumToAmountBaseUnits: "890000",
  slippageBps: 100, fees: [], approval: "permit2-exact", quoteBlockNumber: "123",
  quotedAt: "2026-01-01T00:00:00Z", permitDeadline: "1", executionDeadline: "1",
});

describe("cash conversion route", () => {
  test("inventory uses verified Base addresses, decimals and portfolio identities", () => {
    expect(cashConversionCurrencies.map((currency) => currency.code)).toEqual(["USD", "EUR", "IDR", "ARS", "BRL", "COP"]);
    expect(cashConversionCurrencies).toEqual([canonicalUsdcAsset, ...Object.values(verifiedLocalCashAssets)].map((asset) => ({
      code: asset.cashCurrency, convertOffered: ["USD", "EUR", "IDR"].includes(asset.cashCurrency),
      name: asset.name, symbol: asset.symbol, decimals: asset.decimals,
      address: parseAddress(asset.contractAddress)!, portfolioAssetId: asset.id,
      tradeAssetId: asset.cashCurrency === "USD" ? "usdc" : `base:${asset.contractAddress.toLowerCase()}`,
    })));
    expect(cashConversionCurrencies.map(({ code, convertOffered }) => [code, convertOffered])).toEqual([
      ["USD", true], ["EUR", true], ["IDR", true],
      ["ARS", false], ["BRL", false], ["COP", false],
    ]);
    expect(() => cashConversionCurrency("GBP" as "USD")).toThrow("Unsupported Cash conversion currency: GBP");
  });
  test("USD can convert to local cash; local cash can only convert to USD", () => {
    expect(cashConversionDestinations("USD")).toEqual([eur, idr, ars, brl, cop]);
    expect(cashConversionDestinations("EUR")).toEqual([usd]);
    expect(cashConversionDestinations("IDR")).toEqual([usd]);
    expect(cashConversionDestinations("ARS")).toEqual([]);
    expect(cashConversionDestinations("BRL")).toEqual([]);
    expect(cashConversionDestinations("COP")).toEqual([]);
    expect(cashConversionTrade("USD", "EUR")).toEqual({ assetId: eur.tradeAssetId, direction: "buy" });
    expect(cashConversionTrade("USD", "IDR")).toEqual({ assetId: idr.tradeAssetId, direction: "buy" });
    expect(cashConversionTrade("EUR", "USD")).toEqual({ assetId: eur.tradeAssetId, direction: "sell" });
    expect(cashConversionTrade("IDR", "USD")).toEqual({ assetId: idr.tradeAssetId, direction: "sell" });
    expect(cashConversionTrade("EUR", "IDR")).toBeNull();
    expect(cashConversionTrade("USD", "ARS")).toBeNull();
    expect(cashConversionTrade("ARS", "USD")).toBeNull();
    expect(cashConversionTrade("ARS", "BRL")).toBeNull();
    expect(cashConversionTrade("USD", "USD")).toBeNull();
    expect(cashConversionDestinations("GBP" as "USD")).toEqual([]);
  });
  test("classification requires exact Base cash addresses and decimals, not symbols", () => {
    expect(cashConversionPair(metadata())).toEqual({ from: usd, to: eur });
    expect(cashConversionPair(metadata(idr, usd))).toEqual({ from: idr, to: usd });
    expect(cashConversionPair(metadata(usd, ars))).toBeNull();
    expect(cashConversionPair({ ...metadata(), fromAsset: { ...metadata().fromAsset, symbol: "FAKE" } })).toEqual({ from: usd, to: eur });
    expect(cashConversionPair({ ...metadata(), toAsset: { ...metadata().toAsset, address: usd.address } })).toBeNull();
    expect(cashConversionPair({ ...metadata(), toAsset: { ...metadata().toAsset, decimals: 18 } })).toBeNull();
    expect(cashConversionPair({ ...metadata(), network: { name: "Base", chainId: 1 } as unknown as TradeMoneyActionMetadata["network"] })).toBeNull();
    expect(cashConversionPair(metadata(eur, idr))).toBeNull();
    expect(cashConversionPair({ ...metadata(), direction: "sell" })).toBeNull();
  });
});
