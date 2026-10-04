import { describe, expect, test } from "bun:test";
import { getAddress } from "viem";
import { CURRENCY_REGISTRY } from "./registry";
import { CONVERT_PAIRS, resolveConvertPair } from "./convert";
import { cashConversionInventory, cashConversionTrade, cashConversionDestinations } from "@/shared/trading/cash-conversion";
import { currencyRegistryDrift } from "./drift";
import { CONVERT_PROVIDER, type ConvertPairRecord, type CurrencyRepresentation } from "./types";

const asOf = new Date("2026-09-30T00:00:00Z");
const pair: ConvertPairRecord = {
  id: "eurc-to-usdc", from: "base:eurc", to: "base:usdc", provider: CONVERT_PROVIDER,
  regions: "all", status: "verified", verifiedAt: "2026-09-08", evidence: "test fixture",
};
const reverse = { ...pair, id: "usdc-to-eurc", from: pair.to, to: pair.from };
function requiredRecord(id: string): CurrencyRepresentation {
  const record = CURRENCY_REGISTRY.find((entry) => entry.id === id);
  if (!record) throw new Error(`Missing currency record: ${id}`);
  return record;
}

const eur = requiredRecord("base:eurc");
const wars = requiredRecord("base:wars");
const firstRecord = CURRENCY_REGISTRY[0];
if (!firstRecord) throw new Error("Missing first currency record.");
const replace = (id: string, change: Partial<CurrencyRepresentation>): CurrencyRepresentation[] =>
  CURRENCY_REGISTRY.map((record) => record.id === id ? { ...record, ...change } : record);
const codes = (records: readonly CurrencyRepresentation[], pairs: readonly ConvertPairRecord[] = []) =>
  currencyRegistryDrift({ records, pairs, asOf }).map((finding) => finding.code);

describe("currency registry drift", () => {
  test("the actual registry has no findings", () => {
    expect(currencyRegistryDrift({ records: CURRENCY_REGISTRY, pairs: CONVERT_PAIRS })).toEqual([]);
  });
  test("admits exactly the verified USD local topology with exact execution identities", () => {
    const inventory = cashConversionInventory();
    const locals = [
      ["ARS", "base:wars", "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d"],
      ["BRL", "base:wbrl", "0xd76f5faf6888e24d9f04bf92a0c8b921fe4390e0"],
      ["COP", "base:wcop", "0x8a1d45e102e886510e891d2ec656a708991e2d76"],
    ] as const;
    expect(CONVERT_PAIRS).toHaveLength(10);
    expect(CONVERT_PAIRS.every((entry) => entry.from === "base:usdc" || entry.to === "base:usdc")).toBe(true);
    for (const [currency, id, address] of locals) {
      expect(inventory.find((entry) => entry.code === currency)).toMatchObject({ convertOffered: true, address, decimals: 18, tradeAssetId: `base:${address}` });
      expect(requiredRecord(id)).toMatchObject({ chainId: 8453, contractAddress: currency === "BRL" ? getAddress(address) : address, decimals: 18 });
      expect(cashConversionTrade("USD", currency)).toEqual({ assetId: `base:${address}`, direction: "buy" });
      expect(cashConversionTrade(currency, "USD")).toEqual({ assetId: `base:${address}`, direction: "sell" });
      expect(cashConversionDestinations(currency).map((entry) => entry.code)).toEqual(["USD"]);
      for (const endpoints of [{ from: "base:usdc", to: id }, { from: id, to: "base:usdc" }]) {
        expect(resolveConvertPair({ ...endpoints, now: new Date("2026-10-04T12:00:00Z") }).status).toBe("eligible");
      }
      for (const [other] of locals) if (other !== currency) expect(cashConversionTrade(currency, other)).toBeNull();
    }
  });
  test("reports silent funding omissions", () => {
    expect(codes(CURRENCY_REGISTRY.filter((record) => record !== wars))).toEqual(["missing-funding-record"]);
  });
  test("reports unknown and mismatched funding identities", () => {
    const unknownFunding = { ...eur };
    Object.assign(unknownFunding, { fundingId: "base:not-real" });
    expect(codes(replace(eur.id, unknownFunding))).toEqual(["unknown-funding-id"]);
    expect(codes(replace(wars.id, { decimals: 6 }))).toEqual(["unknown-funding-id"]);
    const mismatched = CURRENCY_REGISTRY.map((record) => record.id === wars.id
      ? { ...record, displayCurrency: "MXN" as const, aliases: ["wARS"] } : record);
    expect(codes(mismatched)).toEqual(["unknown-funding-id"]);
  });
  test("reports duplicate IDs and contracts", () => {
    expect(codes(replace(eur.id, { id: "base:usdc" }))).toEqual(["duplicate-identity"]);
    expect(codes(replace(eur.id, { contractAddress: firstRecord.contractAddress }))).toEqual(["duplicate-identity"]);
  });
  test("reports malformed contract addresses on non-funding records", () => {
    expect(codes(replace(eur.id, { contractAddress: "0x123" }))).toEqual(["invalid-identity"]);
    expect(codes(replace(eur.id, { contractAddress: "0xaBcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD" }))).toEqual(["invalid-identity"]);
  });
  test("reports invalid decimal scales on a synthetic non-funding record", () => {
    const synthetic: CurrencyRepresentation = {
      ...eur, id: "base:synthetic", contractAddress: "0x9999999999999999999999999999999999999999",
      displayCurrency: "MXN", aliases: ["MXNT"],
    };
    for (const decimals of [1.5, -1, 256]) {
      expect(currencyRegistryDrift({ records: [...CURRENCY_REGISTRY, { ...synthetic, decimals }], pairs: [], asOf })).toEqual([
        { code: "invalid-decimals", message: "Decimal scale is invalid for base:synthetic", recordId: synthetic.id },
      ]);
    }
  });
  test("accepts lowercase and checksummed contract addresses", () => {
    const lowercase: CurrencyRepresentation["contractAddress"] = `0x${eur.contractAddress.slice(2).toLowerCase()}`;
    expect(codes(replace(eur.id, { contractAddress: lowercase }))).toEqual([]);
    expect(codes(replace(eur.id, { contractAddress: getAddress(eur.contractAddress) }))).toEqual([]);
  });
  test("reports repeated and unauthorized fiat aliases and two Cash identities", () => {
    expect(codes(replace(eur.id, { aliases: ["USDC"] }))).toEqual(["duplicate-alias"]);
    expect(codes(replace(eur.id, { aliases: ["ARS"] }))).toEqual(["duplicate-alias"]);
    const duplicateCash = {
      ...eur, id: "base:other-eur", contractAddress: "0x9999999999999999999999999999999999999999" as const,
      aliases: ["OTHEREUR"],
    };
    expect(codes([...CURRENCY_REGISTRY, duplicateCash])).toEqual(["duplicate-alias"]);
  });
  test("reports incomplete deferred and paused dispositions", () => {
    expect(codes(replace(wars.id, { cash: { state: "deferred", reference: "#1494" } }))).toEqual(["undispositioned-record"]);
    expect(codes(replace(wars.id, { cash: { state: "paused" } }))).toEqual(["undispositioned-record"]);
  });
  test("requires dispositions for send and valuation as well as Cash", () => {
    expect(codes(replace(wars.id, { send: { state: "deferred" } }))).toContain("undispositioned-record");
    expect(codes(replace(wars.id, { valuation: { state: "paused" } }))).toContain("undispositioned-record");
  });
  test("requires approved Send and valuation for inventory records even when Cash pauses", () => {
    expect(codes(replace(eur.id, { send: { state: "deferred", reason: "not verified", reference: "test" } }))).toEqual(["missing-exit-capability"]);
    expect(codes(replace(eur.id, { cash: { state: "paused", reason: "exit only" }, valuation: { state: "paused", reason: "price paused" }, aliases: ["EURC"] }))).toEqual(["missing-valuation"]);
  });
  test("requires dated, traceable provenance", () => {
    expect(codes(replace(eur.id, { provenance: { source: "", verifiedAt: "2026-09-07" } }))).toEqual(["invalid-provenance"]);
    expect(codes(replace(eur.id, { provenance: { source: "docs/currency-defaults.md", verifiedAt: "yesterday" } }))).toEqual(["invalid-provenance"]);
    expect(codes(replace(eur.id, { provenance: { source: "internal", verifiedAt: "2026-09-07" } }))).toEqual(["invalid-provenance"]);
    expect(codes(replace(eur.id, { provenance: { source: "docs/currency-defaults.md", verifiedAt: "2026-99-99" } }))).toEqual(["invalid-provenance"]);
    expect(codes(replace(eur.id, { provenance: { source: "docs/currency-defaults.md", verifiedAt: "2099-01-01" } }))).toEqual(["invalid-provenance"]);
    expect(codes(replace(eur.id, { provenance: { source: "httpbogus", verifiedAt: "2026-09-07" } }))).toEqual(["invalid-provenance"]);
    expect(codes(replace(eur.id, { provenance: { source: "docs/currency-defaults.md", verifiedAt: "2026-09-07" } }))).toEqual([]);
  });
  test("requires evidence for approvals and disables Cash approval on paused or withdrawn records", () => {
    expect(codes(replace(eur.id, { cash: { state: "approved", verifiedAt: "2026-09-08" } }))).toEqual(["missing-capability-evidence"]);
    for (const capability of ["cash", "send", "valuation"] as const) {
      expect(codes(replace(eur.id, { [capability]: { ...eur[capability], verifiedAt: "not-a-date" } }))).toEqual(["missing-capability-evidence"]);
      expect(codes(replace(eur.id, { [capability]: { ...eur[capability], verifiedAt: "2099-01-01" } }))).toEqual(["missing-capability-evidence"]);
    }
    expect(codes(replace(eur.id, { lifecycle: "withdrawn", aliases: ["EURC"] }))).toEqual(["lifecycle-conflict"]);
    expect(codes(replace(eur.id, { lifecycle: "paused", aliases: ["EURC"] }))).toEqual(["lifecycle-conflict"]);
    expect(codes(replace(eur.id, { lifecycle: "paused", aliases: ["EURC"] }), [pair, reverse])).toEqual(["lifecycle-conflict", "missing-capability-evidence", "missing-capability-evidence"]);
    expect(codes(replace(eur.id, { cash: { state: "paused", reason: "exit only" }, aliases: ["EURC"] }), [pair, reverse])).toEqual(["missing-capability-evidence", "missing-capability-evidence"]);
  });
  test("withdrawn inventory retains verified Send and valuation for an exit", () => {
    const withdrawn = replace(eur.id, {
      lifecycle: "withdrawn", cash: { state: "withdrawn", reason: "exit only" }, aliases: ["EURC"],
    });
    expect(codes(withdrawn)).toEqual([]);
    expect(codes(replace(eur.id, { lifecycle: "withdrawn", aliases: ["EURC"] }))).toContain("lifecycle-conflict");
  });
  test("reports cash without valuation", () => {
    expect(codes(replace(eur.id, { valuation: { state: "deferred", reason: "test", reference: "test" } }))).toEqual(["missing-valuation"]);
  });
  test("reports unknown pair assets", () => {
    expect(codes(CURRENCY_REGISTRY, [{ ...pair, from: "base:missing" }])).toEqual(["unknown-pair-asset", "pair-incomplete"]);
  });
  test("reports self-pairs, missing verified proof and duplicate pair keys", () => {
    expect(codes(CURRENCY_REGISTRY, [{ ...pair, to: pair.from }])).toEqual(["invalid-pair"]);
    expect(codes(CURRENCY_REGISTRY, [{ ...pair, evidence: "" }, reverse])).toEqual(["invalid-pair"]);
    expect(codes(CURRENCY_REGISTRY, [pair, { ...pair, id: "duplicate" }, reverse])).toEqual(["invalid-pair"]);
  });
  test("requires a reason for paused and withdrawn pairs", () => {
    for (const status of ["paused", "withdrawn"] as const) {
      for (const reason of [undefined, "", "  "]) {
        expect(codes(CURRENCY_REGISTRY, [{ ...pair, status, reason }])).toEqual(["undispositioned-pair"]);
      }
      expect(codes(CURRENCY_REGISTRY, [{ ...pair, status, reason: "route paused" }])).toEqual([]);
    }
  });
  test("reports stale verified pairs", () => {
    expect(codes(CURRENCY_REGISTRY, [{ ...pair, verifiedAt: "2025-01-01" }, reverse])).toEqual(["stale-pair"]);
  });
  test("rejects malformed, rolled-over and future verified pair dates", () => {
    for (const verifiedAt of ["not-a-date", "2026-09-31", "2099-01-01"]) {
      expect(codes(CURRENCY_REGISTRY, [{ ...pair, verifiedAt }, reverse])).toEqual(["invalid-pair"]);
    }
  });
  test("requires a verified reverse pair and unscoped execution for published pairs", () => {
    expect(codes(CURRENCY_REGISTRY, [pair])).toEqual(["pair-incomplete"]);
    expect(codes(CURRENCY_REGISTRY, [pair, { ...reverse, status: "paused", reason: "route paused" }])).toEqual(["pair-incomplete"]);
    expect(codes(CURRENCY_REGISTRY, [pair, reverse])).toEqual([]);
    for (const regions of [["US"] as const, [] as const]) {
      expect(codes(CURRENCY_REGISTRY, [{ ...pair, regions }, reverse])).toEqual(["region-scoped-pair"]);
    }
  });
});
