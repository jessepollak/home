import { describe, expect, test } from "bun:test";
import { CONVERT_PAIRS, convertPairListed, convertPickerEntries, resolveConvertPair } from "./convert";
import { CURRENCY_REGISTRY, approvedCashCurrencies, recordsWithPreservedHoldings } from "./registry";
import { CONVERT_PROVIDER, type ConvertPairRecord, type ConvertUnavailableReason, type CurrencyRepresentation } from "./types";

const usd = CURRENCY_REGISTRY.find((record) => record.id === "base:usdc");
if (!usd) throw new Error("Missing USDC currency record.");
const promoted: CurrencyRepresentation = {
  ...usd,
  id: "base:mxn",
  fundingId: null,
  contractAddress: "0x9999999999999999999999999999999999999999",
  symbol: "MXNTEST",
  name: "Synthetic peso",
  displayCurrency: "MXN",
  aliases: ["MXNTEST", "MXN"],
};
const deferredIdentity: CurrencyRepresentation = {
  ...promoted,
  id: "base:ngnt",
  contractAddress: "0x8888888888888888888888888888888888888888",
  symbol: "NGNT",
  displayCurrency: "NGN",
  aliases: ["NGNT"],
  cash: { state: "deferred", reason: "identity only", reference: "#1494" },
};
const records = [...CURRENCY_REGISTRY, promoted, deferredIdentity];
const pair: ConvertPairRecord = {
  id: "mxn-to-usdc",
  from: promoted.id,
  to: usd.id,
  provider: CONVERT_PROVIDER,
  regions: "all",
  status: "verified",
  verifiedAt: "2026-09-08",
  evidence: "synthetic test fixture",
};
const reverse = { ...pair, id: "usdc-to-mxn", from: pair.to, to: pair.from };
const now = new Date("2026-09-10T00:00:00Z");
const input = { from: promoted.id, to: usd.id, now };
const data = { records, pairs: [pair, reverse] };
const unavailable = (reason: ConvertUnavailableReason, value: ReturnType<typeof resolveConvertPair>) =>
  expect(value).toEqual({ status: "unavailable", reason });

const publishedPair = CONVERT_PAIRS[0];
if (!publishedPair) throw new Error("Missing published Convert pair.");
const publishedPairDate = new Date(`${publishedPair.verifiedAt}T00:00:00Z`);

describe("Convert pair admission", () => {
  test("ships only the live Cash Convert pairs and lists exactly their currencies", () => {
    expect(CONVERT_PAIRS.map((entry) => entry.id)).toEqual(["usdc-eurc", "eurc-usdc", "usdc-idrx", "idrx-usdc"]);
    expect(convertPickerEntries().map((entry) => entry.displayCurrency)).toEqual(["EUR", "IDR"]);
    expect(resolveConvertPair({ from: "base:eurc", to: usd.id, now: publishedPairDate })).toMatchObject({ status: "eligible" });
    unavailable("pair-missing", resolveConvertPair({ from: "base:idrx", to: "base:eurc" }));
  });

  test("a paused or withdrawn published pair leaves the currency in Cash and out of Convert", () => {
    for (const status of ["paused", "withdrawn"] as const) {
      const stopped = CONVERT_PAIRS.map((entry) => entry.from === "base:eurc" || entry.to === "base:eurc" ? { ...entry, status } : entry);
      expect(convertPickerEntries({}, { pairs: stopped }).map((entry) => entry.displayCurrency)).toEqual(["IDR"]);
    }
    expect(approvedCashCurrencies().map((record) => record.displayCurrency)).toContain("EUR");
    expect(recordsWithPreservedHoldings().map((record) => record.displayCurrency)).not.toContain("EUR");
  });

  test("the dated rule admits a trade without gating the picker on the device clock", () => {
    const stale = CONVERT_PAIRS.map((entry) => ({ ...entry, verifiedAt: "2020-01-01" }));
    unavailable("pair-stale", resolveConvertPair({ from: "base:eurc", to: usd.id, now }, { pairs: stale }));
    expect(convertPairListed({ from: "base:eurc", to: usd.id }, { pairs: stale })).toBe(true);
    expect(convertPickerEntries({}, { pairs: stale }).map((entry) => entry.displayCurrency)).toEqual(["EUR", "IDR"]);
  });

  test("requires both verified directions before a promoted currency appears in the picker", () => {
    unavailable("pair-missing", resolveConvertPair(input, { records, pairs: [] }));
    expect(resolveConvertPair(input, data)).toEqual({ status: "eligible", pair, from: promoted, to: usd });
    expect(convertPickerEntries({}, { records, pairs: [pair] })).toEqual([]);
    expect(convertPickerEntries({}, { records, pairs: [reverse] })).toEqual([]);
    expect(convertPickerEntries({}, data)).toContainEqual({
      id: promoted.id, name: promoted.name, symbol: promoted.symbol,
      displayCurrency: "MXN", marketPriceAssetId: `base:${promoted.contractAddress}`,
    });
  });

  test("pausing a route does not hide an approved holding", () => {
    const paused = { ...pair, status: "paused" as const };
    unavailable("pair-paused", resolveConvertPair(input, { records, pairs: [paused] }));
    expect(convertPickerEntries({}, { records, pairs: [paused] })).toEqual([]);
    expect(approvedCashCurrencies(records)).toContain(promoted);
    expect(recordsWithPreservedHoldings(records)).not.toContain(promoted);
    expect(recordsWithPreservedHoldings(records.map((record) => record === promoted ? { ...record, cash: { state: "paused" as const, reason: "exit only" } } : record))).toContainEqual(
      expect.objectContaining({ id: promoted.id }),
    );
  });

  test("returns ordered unavailable reasons", () => {
    unavailable("same-asset", resolveConvertPair({ ...input, to: promoted.id }, data));
    unavailable("asset-unknown", resolveConvertPair({ ...input, to: "base:missing" }, data));
    unavailable("asset-not-cash-approved", resolveConvertPair({ ...input, from: deferredIdentity.id }, data));
    unavailable("asset-inactive", resolveConvertPair(input, { ...data, records: records.map((record) => record === promoted ? { ...record, lifecycle: "paused" } : record) }));
    unavailable("pair-withdrawn", resolveConvertPair(input, { records, pairs: [{ ...pair, status: "withdrawn" }] }));
    unavailable("region-ineligible", resolveConvertPair({ ...input, regionId: "DE" }, { records, pairs: [{ ...pair, regions: ["US"] }] }));
    expect(resolveConvertPair({ ...input, now: new Date("2027-03-06T00:00:00Z") }, data).status).toBe("eligible");
    unavailable("pair-stale", resolveConvertPair({ ...input, now: new Date("2027-03-08T00:00:00Z") }, data));
    for (const verifiedAt of ["2099-01-01", "2026-09-31", "not-a-date"]) {
      unavailable("pair-stale", resolveConvertPair(input, { records, pairs: [{ ...pair, verifiedAt }] }));
    }
  });

  test("fails closed without a region and after a record rollback", () => {
    unavailable("region-ineligible", resolveConvertPair(input, { records, pairs: [{ ...pair, regions: ["US"] }] }));
    const rolledBack = records.filter((record) => record !== promoted);
    unavailable("asset-unknown", resolveConvertPair(input, { records: rolledBack, pairs: [pair] }));
    expect(convertPickerEntries({}, { records: rolledBack, pairs: [pair] })).toEqual([]);
  });
});
