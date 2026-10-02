import { describe, expect, test } from "bun:test";
import { canonicalUsdcAsset, verifiedLocalCashAssets } from "@/config/portfolio-assets";
import { parseAddress } from "@/shared/chain/hex";
import type { FiatCurrencyCode } from "@/config/regions";
import { CONVERT_PAIRS, convertCurrencyListed, convertPickerEntries } from "@/shared/currencies/convert";
import { cashCurrencyForContract, currencyRecordById, currencyRecordForContract } from "@/shared/currencies/registry";
import { CONVERT_PROVIDER, type ConvertPairRecord, type CurrencyRepresentation } from "@/shared/currencies/types";
import type { TradeMoneyActionMetadata } from "./contract";
import { cashConversionCurrencies, cashConversionCurrency, cashConversionDestinations, cashConversionInventory, cashConversionPair, cashConversionTrade, type CashConversionCurrency } from "./cash-conversion";

function requiredCurrency(code: FiatCurrencyCode): CashConversionCurrency {
  const currency = cashConversionCurrencies.find((entry) => entry.code === code);
  if (!currency) throw new Error(`Missing cash conversion currency: ${code}`);
  return currency;
}

const usd = requiredCurrency("USD");
const eur = requiredCurrency("EUR");
const idr = requiredCurrency("IDR");
const ars = requiredCurrency("ARS");
const brl = requiredCurrency("BRL");
const cop = requiredCurrency("COP");
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
    const cashAssets = [canonicalUsdcAsset, ...Object.values(verifiedLocalCashAssets)].filter(
      (asset): asset is typeof asset & { cashCurrency: FiatCurrencyCode } => asset.cashCurrency !== null,
    );
    expect(cashConversionCurrencies).toEqual(cashAssets.map((asset) => ({
      code: asset.cashCurrency, convertOffered: ["USD", "EUR", "IDR"].includes(asset.cashCurrency),
      name: asset.name, symbol: asset.symbol, decimals: asset.decimals,
      address: parseAddress(asset.contractAddress)!, portfolioAssetId: asset.id,
      tradeAssetId: asset.cashCurrency === "USD" ? "usdc" : `base:${asset.contractAddress.toLowerCase()}`,
    })));
    expect(cashConversionCurrencies.map(({ code, convertOffered }) => [code, convertOffered])).toEqual([
      ["USD", true], ["EUR", true], ["IDR", true],
      ["ARS", false], ["BRL", false], ["COP", false],
    ]);
    expect(cashConversionCurrencies.filter((currency) => currency.convertOffered).map((currency) => currency.code))
      .toEqual(["USD", ...convertPickerEntries().map((entry) => entry.displayCurrency)]);
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
  test("a paused pair removes the destination without hiding the held balance", () => {
    const eurRecord = currencyRecordForContract(eur.address)!;
    const paused = CONVERT_PAIRS.map((entry) => entry.from === eurRecord.id || entry.to === eurRecord.id
      ? { ...entry, status: "paused" as const }
      : entry);
    expect(convertCurrencyListed(eurRecord.id, { pairs: paused })).toBe(false);
    expect(convertPickerEntries({}, { pairs: paused }).map((entry) => entry.displayCurrency)).toEqual(["IDR"]);
    expect(cashConversionInventory({ pairs: paused }).map(({ code, convertOffered }) => [code, convertOffered])).toEqual([
      ["USD", true], ["EUR", false], ["IDR", true], ["ARS", false], ["BRL", false], ["COP", false],
    ]);
    expect(cashConversionTrade("USD", "EUR", { pairs: paused })).toBeNull();
    expect(cashConversionTrade("EUR", "USD", { pairs: paused })).toBeNull();
    expect(cashConversionTrade("USD", "IDR", { pairs: paused })).toEqual({ assetId: idr.tradeAssetId, direction: "buy" });
    expect(cashConversionDestinations("USD")).toContain(eur);
    expect(cashConversionPair(metadata())).toEqual({ from: usd, to: eur });
    expect(cashCurrencyForContract(eur.address)).toBe("EUR");
    expect(cashConversionCurrencies.map((currency) => currency.code)).toContain("EUR");
  });
  test("withdrawing every route removes the Convert entry without hiding a balance", () => {
    const stopped = CONVERT_PAIRS.map((entry) => ({ ...entry, status: "withdrawn" as const }));
    const inventory = cashConversionInventory({ pairs: stopped });
    expect(inventory.every((currency) => !currency.convertOffered)).toBe(true);
    expect(inventory.map((currency) => currency.code)).toEqual(["USD", "EUR", "IDR", "ARS", "BRL", "COP"]);
    expect(cashConversionTrade("USD", "EUR", { pairs: stopped })).toBeNull();
    expect(cashConversionTrade("EUR", "USD", { pairs: stopped })).toBeNull();
    expect(cashConversionDestinations("USD").map((currency) => currency.code)).toEqual(["EUR", "IDR", "ARS", "BRL", "COP"]);
    expect(cashConversionPair(metadata())).toEqual({ from: usd, to: eur });
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

describe("cash conversion historical identity", () => {
  const usdRecord = currencyRecordById("base:usdc")!;
  const syntheticLocal: CurrencyRepresentation = {
    ...usdRecord,
    id: "base:wsyn",
    contractAddress: "0x1111111111111111111111111111111111111111",
    decimals: 18,
    name: "Synthetic peso",
    symbol: "wSYN",
    displayCurrency: "MXN",
    fundingId: null,
    aliases: ["wSYN"],
  };
  const localCurrency: CashConversionCurrency = {
    code: "MXN",
    convertOffered: false,
    name: "Synthetic peso",
    symbol: "wSYN",
    decimals: 18,
    address: parseAddress("0x1111111111111111111111111111111111111111")!,
    portfolioAssetId: "wsyn",
    tradeAssetId: "base:0x1111111111111111111111111111111111111111",
  };
  const syntheticPair: ConvertPairRecord = {
    id: "usdc-wsyn", from: "base:usdc", to: "base:wsyn", provider: CONVERT_PROVIDER,
    regions: "all", status: "verified", verifiedAt: "2026-09-29", evidence: "synthetic",
  };
  const pairs = [
    syntheticPair,
    { ...syntheticPair, id: "wsyn-usdc", from: "base:wsyn", to: "base:usdc" },
  ];

  for (const { state, lifecycle } of [
    { state: "paused", lifecycle: "active" },
    { state: "withdrawn", lifecycle: "active" },
    { state: "approved", lifecycle: "paused" },
  ] as const) {
    test(`classifies buy and sell identities with Cash ${state} and lifecycle ${lifecycle}`, () => {
      const record = { ...syntheticLocal, cash: { state }, lifecycle };
      const data = { records: [usdRecord, record], pairs };
      expect(cashConversionPair(metadata(usd, localCurrency), data)).toEqual({ from: usd, to: localCurrency });
      expect(cashConversionPair(metadata(localCurrency, usd), data)).toEqual({ from: localCurrency, to: usd });
    });
  }

  for (const status of ["paused", "withdrawn"] as const) {
    test(`keeps historical identities with a ${status} pair`, () => {
      const data = {
        records: [usdRecord, syntheticLocal],
        pairs: pairs.map((pair) => ({ ...pair, status })),
      };
      expect(cashConversionPair(metadata(usd, localCurrency), data)).toEqual({ from: usd, to: localCurrency });
      expect(cashConversionPair(metadata(localCurrency, usd), data)).toEqual({ from: localCurrency, to: usd });
    });
  }

  test("malformed preserved records do not hide valid classifications", () => {
    const data = {
      records: [
        usdRecord, currencyRecordById("base:eurc")!,
        { ...syntheticLocal, id: "base:broken", contractAddress: "0x123" as const },
        { ...syntheticLocal, id: "base:broken-checksum", contractAddress: "0xaBcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD" as const },
      ],
      pairs: CONVERT_PAIRS,
    };
    expect(() => cashConversionPair(metadata(), data)).not.toThrow();
    expect(cashConversionPair(metadata(), data)).toEqual({ from: usd, to: eur });
    expect(cashConversionPair(metadata(usd, localCurrency), data)).toBeNull();
  });

  test("does not classify a never-promoted identity", () => {
    const deferred: CurrencyRepresentation = { ...syntheticLocal, cash: { state: "deferred", reason: "identity only" } };
    const data = { records: [usdRecord, deferred], pairs };
    expect(cashConversionPair(metadata(usd, localCurrency), data)).toBeNull();
    expect(cashConversionPair(metadata(localCurrency, usd), data)).toBeNull();
  });

  test("requires a declared pair for the recorded direction", () => {
    const records = [usdRecord, syntheticLocal];
    expect(cashConversionPair(metadata(usd, localCurrency), { records, pairs: [] })).toBeNull();
    expect(cashConversionPair(metadata(localCurrency, usd), { records, pairs: [] })).toBeNull();
    expect(cashConversionPair(metadata(localCurrency, usd), { records, pairs: [syntheticPair] })).toBeNull();
  });

  test("rejects a historical identity with mismatched decimals", () => {
    const data = { records: [usdRecord, syntheticLocal], pairs };
    const buy = metadata(usd, localCurrency);
    const sell = metadata(localCurrency, usd);
    expect(cashConversionPair({ ...buy, toAsset: { ...buy.toAsset, decimals: 6 } }, data)).toBeNull();
    expect(cashConversionPair({ ...sell, fromAsset: { ...sell.fromAsset, decimals: 6 } }, data)).toBeNull();
  });
});
