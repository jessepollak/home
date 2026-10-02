import { describe, expect, test } from "bun:test";
import { getAddress } from "viem";
import { investAssets, stockAssets } from "@/config/invest-assets";
import { BASE_USDC } from "@/shared/assets/base";
import { requireAddress } from "@/shared/chain/hex";
import { CURRENCY_REGISTRY } from "@/shared/currencies/registry";
import { resolveConvertPair } from "@/shared/currencies/convert";
import { CONVERT_PROVIDER, type ConvertPairRecord, type CurrencyRepresentation } from "@/shared/currencies/types";
import { VERIFIED_MORPHO_MARKETS } from "@/shared/morpho-markets/config";
import { buyRouteForToken, convertCurrencyTradeable, convertDirectionAdmitted, resolveTradeAsset, tradeMetadataTradeable } from "./assets";
import type { TradeAssetRef, TradeDirection, TradeMoneyActionMetadata } from "./contract";

function requiredRecord(id: string): CurrencyRepresentation {
  const record = CURRENCY_REGISTRY.find((entry) => entry.id === id);
  if (!record) throw new Error(`Missing currency record: ${id}`);
  return record;
}

describe("Buy route by token identity", () => {
  test.each([...VERIFIED_MORPHO_MARKETS])("routes $collateralToken.symbol by exact Base contract", (market) => {
    const address = market.collateralToken.address;
    const route = investAssets.find((asset) => asset.contractAddress.toLowerCase() === address.toLowerCase())?.id ?? `base:${address.toLowerCase()}`;
    for (const variant of [address, address.toLowerCase(), getAddress(address)]) {
      expect(buyRouteForToken({ chainId: market.chainId, address: variant })).toBe(route);
    }
  });
  test("rejects other chains, USDC, stocks, and malformed addresses", () => {
    expect(buyRouteForToken({ chainId: 1, address: VERIFIED_MORPHO_MARKETS[0]!.collateralToken.address })).toBeNull();
    expect(buyRouteForToken({ chainId: 8453, address: BASE_USDC.address })).toBeNull();
    expect(buyRouteForToken({ chainId: 8453, address: stockAssets[0]!.contractAddress })).toBeNull();
    expect(buyRouteForToken({ chainId: 8453, address: "0xnot-a-contract" })).toBeNull();
  });
  test("admits the published Convert pairs and never a currency without a verified pair", () => {
    const invest = investAssets.find((asset) => asset.category !== "stock");
    if (!invest) throw new Error("Missing non-stock investment asset.");
    expect(resolveTradeAsset(invest.id)).toMatchObject({ status: "tradeable", configured: invest });
    for (const id of ["base:eurc", "base:idrx"]) {
      const record = requiredRecord(id);
      expect(resolveTradeAsset(`base:${record.contractAddress.toLowerCase()}`)).toMatchObject({ status: "tradeable" });
    }
    const wars = requiredRecord("base:wars");
    const marketId = `base:${wars.contractAddress.toLowerCase()}`;
    expect(resolveTradeAsset(marketId)).toBeNull();
    const usdcId = `base:${BASE_USDC.address.toLowerCase()}`;
    expect(resolveTradeAsset(usdcId, { convertPair: () => ({ status: "unavailable", reason: "pair-missing" }) })).toBeNull();
  });
  test("only fully verified pairs admit a registry cash trade", () => {
    const record = requiredRecord("base:eurc");
    const assetId = `base:${record.contractAddress.toLowerCase()}`;
    const noPair: typeof resolveConvertPair = (input) => resolveConvertPair(input, { pairs: [] });
    expect(resolveTradeAsset(assetId, { convertPair: noPair })).toBeNull();
    for (const direction of ["sell", "buy"] as const) {
      const pair = { id: `eurc-${direction}`, from: direction === "sell" ? record.id : "base:usdc",
        to: direction === "sell" ? "base:usdc" : record.id, provider: CONVERT_PROVIDER,
        regions: "all" as const, status: "verified" as const, verifiedAt: "2026-09-28", evidence: "test fixture" };
      const convertPair: typeof resolveConvertPair = (input) => resolveConvertPair({ ...input, now: new Date("2026-09-28T12:00:00Z") }, { pairs: [pair] });
      expect(resolveTradeAsset(assetId, { convertPair })).toBeNull();
      expect(convertDirectionAdmitted(record.id, direction, { convertPair })).toBe(true);
      expect(convertDirectionAdmitted(record.id, direction === "sell" ? "buy" : "sell", { convertPair })).toBe(false);
    }
    const sell = { id: "eurc-sell", from: record.id, to: "base:usdc", provider: CONVERT_PROVIDER,
      regions: "all" as const, status: "verified" as const, verifiedAt: "2026-09-28", evidence: "test fixture" };
    const buy = { ...sell, id: "eurc-buy", from: sell.to, to: sell.from };
    const both: typeof resolveConvertPair = (input) => resolveConvertPair({ ...input, now: new Date("2026-09-28T12:00:00Z") }, { pairs: [sell, buy] });
    expect(resolveTradeAsset(assetId, { convertPair: both })).toMatchObject({ status: "tradeable", assetId });
  });
});

describe("Convert currency and stored trade admission", () => {
  const currency = requiredRecord("base:eurc");
  const usdc = requiredRecord("base:usdc");
  const sell: ConvertPairRecord = {
    id: "synthetic-sell", from: currency.id, to: usdc.id, provider: CONVERT_PROVIDER,
    regions: "all", status: "verified", verifiedAt: "2026-09-29", evidence: "test fixture",
  };
  const buy: ConvertPairRecord = { ...sell, id: "synthetic-buy", from: sell.to, to: sell.from };
  function convertPairFor(pairs: readonly ConvertPairRecord[], records: readonly CurrencyRepresentation[] = CURRENCY_REGISTRY): typeof resolveConvertPair {
    return (input) => resolveConvertPair({ ...input, now: new Date("2026-09-30T12:00:00Z") }, { pairs, records });
  }
  function metadataFor(direction: TradeDirection, address: string = currency.contractAddress): Pick<TradeMoneyActionMetadata, "direction" | "fromAsset" | "toAsset"> {
    const traded: TradeAssetRef = { id: "synthetic-asset", symbol: "TEST", decimals: 6, address: requireAddress(address) };
    const quote: TradeAssetRef = { id: usdc.id, symbol: usdc.symbol, decimals: usdc.decimals, address: requireAddress(usdc.contractAddress) };
    return { direction, fromAsset: direction === "sell" ? traded : quote, toAsset: direction === "buy" ? traded : quote };
  }

  test.each(["buy", "sell"] as const)("requires both directions even when only %s is paused", (pausedDirection) => {
    const pairs = [buy, sell].map((pair) => pair.id === `synthetic-${pausedDirection}` ? { ...pair, status: "paused" as const, reason: "test pause" } : pair);
    const deps = { convertPair: convertPairFor(pairs) };
    expect(convertCurrencyTradeable(currency.id, deps)).toBe(false);
    for (const direction of ["buy", "sell"] as const) {
      expect(tradeMetadataTradeable(metadataFor(direction), deps)).toBe(false);
    }
  });

  test("rejects unknown currency ids and currencies without published pairs", () => {
    expect(convertCurrencyTradeable("base:unknown")).toBe(false);
    expect(convertCurrencyTradeable("base:wars")).toBe(false);
    const wars = requiredRecord("base:wars");
    for (const direction of ["buy", "sell"] as const) {
      expect(tradeMetadataTradeable(metadataFor(direction, wars.contractAddress))).toBe(false);
    }
  });

  test.each(["buy", "sell"] as const)("fails closed for a stored %s identity whose registry record is gone", (direction) => {
    expect(tradeMetadataTradeable({ ...metadataFor(direction, currency.contractAddress), currencyRecordId: "base:removed" })).toBe(false);
    expect(tradeMetadataTradeable({ ...metadataFor(direction, "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf"), currencyRecordId: "base:removed" })).toBe(false);
    expect(tradeMetadataTradeable({ ...metadataFor(direction, currency.contractAddress), currencyRecordId: currency.id })).toBe(true);
    expect(tradeMetadataTradeable({ ...metadataFor(direction, currency.contractAddress), currencyRecordId: usdc.id })).toBe(false);
    expect(tradeMetadataTradeable({ ...metadataFor(direction, currency.contractAddress), currencyRecordId: null })).toBe(false);
    expect(tradeMetadataTradeable({ ...metadataFor(direction, "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf"), currencyRecordId: null })).toBe(false);
  });

  test.each(["buy", "sell"] as const)("fails closed for a stored %s identity that names another contract", (direction) => {
    const wars = requiredRecord("base:wars");
    expect(tradeMetadataTradeable({ ...metadataFor(direction, wars.contractAddress), currencyRecordId: currency.id })).toBe(false);
    expect(tradeMetadataTradeable({ ...metadataFor(direction, wars.contractAddress), currencyRecordId: wars.id })).toBe(false);
    expect(tradeMetadataTradeable({ ...metadataFor(direction, currency.contractAddress), currencyRecordId: currency.id })).toBe(true);
  });

  test.each(["buy", "sell"] as const)("leaves non-registry %s assets to their existing gates", (direction) => {
    let pairReads = 0;
    const result = tradeMetadataTradeable(metadataFor(direction, "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf"), {
      convertPair: () => { pairReads += 1; return { status: "unavailable", reason: "pair-paused" }; },
    });
    expect(result).toBe(true);
    expect(pairReads).toBe(0);
  });

  test("admits a synthetic registry record only with both verified pairs", () => {
    const synthetic: CurrencyRepresentation = { ...currency, id: "base:synthetic", contractAddress: "0x1111111111111111111111111111111111111111" };
    const syntheticSell = { ...sell, from: synthetic.id };
    const syntheticBuy = { ...buy, to: synthetic.id };
    const records = [usdc, synthetic];
    expect(convertCurrencyTradeable(synthetic.id, { convertPair: convertPairFor([syntheticSell, syntheticBuy], records) })).toBe(true);
    expect(convertCurrencyTradeable(synthetic.id, { convertPair: convertPairFor([syntheticSell], records) })).toBe(false);
  });

  test.each(["buy", "sell"] as const)("admits stored %s metadata by registry contract rather than asset labels", (direction) => {
    const deps = { convertPair: convertPairFor([buy, sell], [{ ...usdc }, { ...currency }]) };
    expect(convertCurrencyTradeable(currency.id, deps)).toBe(true);
    const metadata = metadataFor(direction);
    const traded = direction === "sell" ? metadata.fromAsset : metadata.toAsset;
    Object.assign(traded, { address: getAddress(currency.contractAddress) });
    expect(tradeMetadataTradeable(metadata, deps)).toBe(true);
  });

  test.each(["buy", "sell"] as const)("rejects an uppercase registry address in stored legacy %s metadata even with both verified pairs", (direction) => {
    const deps = { convertPair: convertPairFor([buy, sell]) };
    expect(convertCurrencyTradeable(currency.id, deps)).toBe(true);
    const metadata = metadataFor(direction);
    const traded = direction === "sell" ? metadata.fromAsset : metadata.toAsset;
    Object.assign(traded, { address: `0x${currency.contractAddress.slice(2).toUpperCase()}` });
    expect(tradeMetadataTradeable(metadata, deps)).toBe(false);
    Object.assign(traded, { address: currency.contractAddress.toLowerCase() });
    expect(tradeMetadataTradeable(metadata, deps)).toBe(true);
  });

  test.each([
    ["paused", { status: "paused", reason: "test pause" }],
    ["stale", { verifiedAt: "2026-01-01" }],
    ["region-scoped", { regions: ["FR"] }],
  ] satisfies [string, Partial<ConvertPairRecord>][])("fails closed for an injected %s pair", (_label, change) => {
    const deps = { convertPair: convertPairFor([{ ...buy, ...change }, sell]) };
    expect(convertCurrencyTradeable(currency.id, deps)).toBe(false);
    for (const direction of ["buy", "sell"] as const) {
      expect(tradeMetadataTradeable(metadataFor(direction), deps)).toBe(false);
    }
  });
});

test("buy route rejects invalid checksum but accepts its checksummed spelling", () => {
  const address = getAddress("0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf");
  expect(buyRouteForToken({ chainId: 8453, address })).toBe("cbbtc");
  expect(buyRouteForToken({ chainId: 8453, address: address.replace("B", "b") })).toBeNull();
});
