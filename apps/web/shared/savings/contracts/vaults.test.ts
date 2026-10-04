import { describe, expect, test } from "bun:test";
import { BASE_USDC_ADDRESS, MORPHO_V1_CANDIDATE_ADDRESSES } from "@/shared/savings/config";
import { parseVaultsResult } from "./vaults";

const source = {
  provider: "Morpho GraphQL", endpoint: "https://api.morpho.org/graphql",
  query: "vaults", fetchedAt: "2026-10-03T00:00:00.000Z",
};
const asset = { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 };
const candidate = {
  version: "v1", vaultAddress: MORPHO_V1_CANDIDATE_ADDRESSES[0],
  name: "Vault", symbol: "USDC", listed: true, chainId: 8453, asset,
  curatorAddress: null, grossApy: null, netApy: 0.04, feeRate: null,
  totalAssetsRaw: "900719925474099312345", liquidityRaw: null,
  stateAsOf: null, blockNumber: null, source,
};
const response = { version: "v1", chainId: 8453, asset, candidates: [candidate], source, stale: false };

describe("parseVaultsResult", () => {
  test("preserves exact amounts, null observations, and extra fields", () => {
    const value = { ...response, extra: "kept", candidates: [{ ...candidate, extra: "kept" }] };
    expect<unknown>(parseVaultsResult(value)).toEqual(value);
  });

  test.each([
    { version: "v2" }, { vaultAddress: "0x1111111111111111111111111111111111111111" },
    { name: null }, { symbol: 6 }, { listed: "true" }, { chainId: 1 },
    { asset: { ...asset, decimals: 18 } }, { netApy: "0.04" }, { stateAsOf: 123 },
    { source: { ...source, query: "vaultPosition" } }, { source: { ...source, fetchedAt: "bad" } },
  ])("rejects malformed vault entries %p", (override) => {
    expect(parseVaultsResult({ ...response, candidates: [{ ...candidate, ...override }] })).toBeNull();
  });

  test("rejects incomplete required observations and case-insensitive duplicate addresses", () => {
    const { netApy: _netApy, ...incomplete } = candidate;
    expect(parseVaultsResult({ ...response, candidates: [incomplete] })).toBeNull();
    expect(parseVaultsResult({ ...response, candidates: [candidate, {
      ...candidate, vaultAddress: candidate.vaultAddress?.toUpperCase(),
    }] })).toBeNull();
  });

  test("rejects legacy unvalidated observation fields", () => {
    const { grossApy: _grossApy, feeRate: _feeRate, totalAssetsRaw: _totalAssetsRaw, ...partial } = candidate;
    expect(parseVaultsResult({ ...response, candidates: [partial] })).toBeNull();
    expect(parseVaultsResult({ ...response, candidates: [{ ...candidate, grossApy: "unknown", netApy: Infinity }] })).toBeNull();
  });

  test.each([
    "curatorAddress", "grossApy", "netApy", "feeRate", "totalAssetsRaw", "liquidityRaw", "stateAsOf", "blockNumber",
  ] as const)("rejects missing or undefined %s observations", (field) => {
    const incomplete: Record<string, unknown> = { ...candidate };
    delete incomplete[field];
    expect(parseVaultsResult({ ...response, candidates: [incomplete] })).toBeNull();
    expect(parseVaultsResult({ ...response, candidates: [{ ...candidate, [field]: undefined }] })).toBeNull();
  });

  test.each([
    { feeRate: -0.001 }, { feeRate: 1.001 }, { feeRate: 1e308 }, { feeRate: "0.1" },
    { feeRate: NaN }, { feeRate: Infinity }, { feeRate: -Infinity },
    ...["grossApy", "netApy"].flatMap((field) =>
      [NaN, Infinity, -Infinity, 1e308, 90_071_992_547_410, -90_071_992_547_410, "0.04", false, {}]
        .map((value) => ({ [field]: value }))),
    { curatorAddress: "0x1234" }, { curatorAddress: `0x${"g".repeat(40)}` }, { curatorAddress: 123 },
    ...["blockNumber", "totalAssetsRaw", "liquidityRaw"].flatMap((field) =>
      ["", "-1", "+1", "1e3", "01", "00", "1.0", " 1", "1 ", 1, false, {}]
        .map((value) => ({ [field]: value }))),
    { stateAsOf: "" }, { stateAsOf: "not-a-timestamp" }, { stateAsOf: {} },
  ])("rejects malformed or out-of-range observations %p", (override) => {
    expect(parseVaultsResult({ ...response, candidates: [{ ...candidate, ...override }] })).toBeNull();
  });

  test.each([
    { feeRate: 0 }, { feeRate: 1 }, { feeRate: 0.00004 },
    ...["grossApy", "netApy"].flatMap((field) =>
      [-0.04, 0, 1.5, 90_071_992_547_409.9, -90_071_992_547_409.9]
        .map((value) => ({ [field]: value }))),
    { curatorAddress: "0x9E33faAE38ff641094fa68c65c2cE600b3410585" },
    { curatorAddress: "0x9e33faae38ff641094fa68c65c2ce600b3410585" },
    ...["blockNumber", "totalAssetsRaw", "liquidityRaw"].flatMap((field) =>
      ["0", "1", "115792089237316195423570985008687907853269984665640564039457584007913129639935"]
        .map((value) => ({ [field]: value }))),
    { stateAsOf: "2026-10-03T00:00:00.000Z" },
    {
      curatorAddress: null, grossApy: null, netApy: null, feeRate: null,
      blockNumber: null, totalAssetsRaw: null, liquidityRaw: null, stateAsOf: null,
    },
  ])("preserves valid provider observations %p", (override) => {
    const value = { ...response, candidates: [{ ...candidate, ...override }] };
    expect<unknown>(parseVaultsResult(value)).toEqual(value);
  });
});
