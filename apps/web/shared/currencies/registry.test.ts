import { describe, expect, test } from "bun:test";
import { getAddress } from "viem";
import { BASE_FUNDING_ASSETS } from "@/shared/assets/base";
import { currencyPortfolioAssets, getDirectPortfolioAssets } from "@/config/portfolio-assets";
import { CONVERT_PAIRS } from "./convert";
import { currencyRegistryDrift } from "./drift";
import {
  CURRENCY_REGISTRY, approvedCashCurrencies, approvedCashRecordForCurrency,
  cashCurrencyForContract, currencyRecordById, currencyRecordForContract,
  marketPriceAssetIdFor, nonDeferredCurrencyRecords, pegCurrencyForContract, recordsWithPreservedHoldings,
} from "./registry";
import { CURRENCY_REGISTRY_VERSION, CONVERT_PROVIDER, type CurrencyRepresentation } from "./types";

function requiredRecord(id: string): CurrencyRepresentation {
  const record = currencyRecordById(id);
  if (!record) throw new Error(`Missing currency record: ${id}`);
  return record;
}

const firstRecord = CURRENCY_REGISTRY[0];
if (!firstRecord) throw new Error("Missing first currency record.");

const syntheticPromoted: CurrencyRepresentation = {
  ...firstRecord, id: "base:mxn", fundingId: null,
  contractAddress: "0x9999999999999999999999999999999999999999",
  name: "Synthetic peso", symbol: "MXNT", displayCurrency: "MXN", decimals: 18,
  aliases: ["MXNT"],
};
const syntheticDeferred: CurrencyRepresentation = {
  ...syntheticPromoted,
  id: "base:naira",
  contractAddress: "0x8888888888888888888888888888888888888888",
  symbol: "NGNT",
  displayCurrency: "NGN",
  aliases: ["NGNT"],
  cash: { state: "deferred", reason: "identity only", reference: "#1494" },
  send: { state: "deferred", reason: "identity only", reference: "#1494" },
  valuation: { state: "deferred", reason: "identity only", reference: "#1494" },
};
const withRecord = (record: CurrencyRepresentation): CurrencyRepresentation[] => [...CURRENCY_REGISTRY, record];

describe("currency registry", () => {
  test("dispositions every funding asset with dated Cash, Send and valuation approvals", () => {
    expect(CURRENCY_REGISTRY_VERSION).toBe(1);
    expect(CONVERT_PAIRS.every((pair) => pair.provider === CONVERT_PROVIDER)).toBe(true);
    expect(approvedCashCurrencies().map((record) => record.displayCurrency)).toEqual(["USD", "EUR", "IDR", "ARS", "BRL", "COP"]);
    expect(approvedCashCurrencies().every((record) => record.send.state === "approved" && record.valuation.state === "approved")).toBe(true);
    for (const [id, asset] of Object.entries(BASE_FUNDING_ASSETS)) {
      const record = CURRENCY_REGISTRY.find((entry) => entry.fundingId === id);
      expect(record).toMatchObject({ id, chainId: asset.chainId, contractAddress: asset.address, decimals: asset.decimals, symbol: asset.symbol });
    }
    expect(CURRENCY_REGISTRY.filter((record) => record.cash.state !== "approved")).toEqual([]);
    expect(recordsWithPreservedHoldings()).toEqual([]);
    expect(currencyRegistryDrift({ records: CURRENCY_REGISTRY, pairs: CONVERT_PAIRS })).toEqual([]);
  });

  test("holds verified identities and derives the direct portfolio from the registry", () => {
    const expected = [
      ["base:usdc", "USDC", 6], ["base:eurc", "EURC", 6], ["base:idrx", "IDRX", 2],
      ["base:wars", "wARS", 18], ["base:wbrl", "wBRL", 18], ["base:wcop", "wCOP", 18],
    ] as const;
    for (const [id, symbol, decimals] of expected) {
      expect(currencyRecordById(id)).toMatchObject({ symbol, decimals });
    }
    expect(currencyRecordById("base:eurc")?.contractAddress).toBe("0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42");
    expect(approvedCashRecordForCurrency("USD")).toBe(currencyRecordById("base:usdc"));
    expect(getDirectPortfolioAssets().filter((asset) => asset.cashCurrency).map((asset) => asset.id))
      .toEqual(["usdc", "eurc", "idrx", "wars", "wbrl", "wcop"]);
  });
  test("preserves paused USDC once without Cash grouping", () => {
    const paused = CURRENCY_REGISTRY.map((record) => record.id === "base:usdc"
      ? { ...record, cash: { state: "paused" as const, reason: "exit only" } } : record);
    const assets = currencyPortfolioAssets(paused);
    expect(assets.filter((asset) => asset.id === "usdc")).toHaveLength(1);
    expect(assets[0]).toMatchObject({ id: "usdc", cashCurrency: null });
  });

  test("projects a synthetic promoted identity exactly and omits a deferred one", () => {
    const assets = currencyPortfolioAssets(withRecord(syntheticPromoted));
    expect(assets.find((asset) => asset.id === "mxn")).toMatchObject({
      id: "mxn", assetKey: `eip155:8453/erc20:${syntheticPromoted.contractAddress}`,
      decimals: 18, cashCurrency: "MXN",
    });
    expect(currencyPortfolioAssets(withRecord(syntheticDeferred)).some((asset) => asset.id === "naira")).toBe(false);
  });
  test("maps every non-deferred record into the direct portfolio inventory exactly once", () => {
    const assets = currencyPortfolioAssets();
    for (const record of CURRENCY_REGISTRY) {
      const projected = assets.filter((asset) => asset.id === record.id.replace(/^base:/, ""));
      expect(projected).toHaveLength(record.cash.state === "deferred" ? 0 : 1);
    }
    const projectedDeferred = currencyPortfolioAssets(withRecord(syntheticDeferred));
    expect(projectedDeferred.some((asset) => asset.id === "naira")).toBe(false);
    expect(projectedDeferred.filter((asset) => asset.id === "usdc")).toHaveLength(1);
  });

  test("looks up strictly valid contracts case-insensitively", () => {
    const eurc = requiredRecord("base:eurc");
    expect(currencyRecordForContract(getAddress(eurc.contractAddress))).toBe(eurc);
    expect(currencyRecordForContract(eurc.contractAddress.toUpperCase().replace("0X", "0x"))).toBeNull();
    expect(cashCurrencyForContract(eurc.contractAddress)).toBe("EUR");
    expect(cashCurrencyForContract(requiredRecord("base:wars").contractAddress)).toBe("ARS");
    expect(cashCurrencyForContract("0x0000000000000000000000000000000000000001")).toBeNull();
    expect(marketPriceAssetIdFor(eurc)).toBe(`base:${eurc.contractAddress.toLowerCase()}`);
    for (const invalid of [null, undefined, "not-a-contract", "0x123", `0x${"g".repeat(40)}`]) {
      expect(currencyRecordForContract(invalid)).toBeNull();
    }
    expect(currencyRecordById("base:unknown")).toBeNull();
  });

  test("preserves non-deferred identities regardless of Cash support or lifecycle", () => {
    const preserved: CurrencyRepresentation[] = [
      { ...syntheticPromoted, cash: { state: "paused", reason: "exit only" } },
      { ...syntheticPromoted, cash: { state: "withdrawn", reason: "exit only" } },
      { ...syntheticPromoted, lifecycle: "paused" },
    ];
    expect(nonDeferredCurrencyRecords([...preserved, syntheticDeferred])).toEqual(preserved);
  });

  test("keeps the historical peg for a paused currency and drops a deferred one", () => {
    const warsAddress = requiredRecord("base:wars").contractAddress;
    const paused = CURRENCY_REGISTRY.map((record) => record.id === "base:wars"
      ? { ...record, cash: { state: "paused" as const, reason: "exit only" } } : record);
    expect(pegCurrencyForContract(warsAddress, paused)).toBe("ARS");
    expect(pegCurrencyForContract(warsAddress)).toBe("ARS");
    expect(pegCurrencyForContract(warsAddress, withRecord(syntheticDeferred))).toBe("ARS");
    expect(pegCurrencyForContract(syntheticDeferred.contractAddress, withRecord(syntheticDeferred))).toBeNull();
    expect(pegCurrencyForContract(requiredRecord("base:eurc").contractAddress)).toBe("EUR");
  });
});
