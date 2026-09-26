import { describe, expect, test } from "bun:test";
import { BASE_USDC_ADDRESS, MORPHO_V1_CANDIDATE_ADDRESSES } from "@/shared/savings/config";
import type { MorphoVaultCandidate, MorphoVaultsResult } from "@/shared/savings/types";
import { retainLastKnownSavingsRates } from "./use-savings-vaults";

const timestamp = "2026-09-10T12:00:00.000Z";
const source = { provider: "Morpho GraphQL", endpoint: "https://api.morpho.org/graphql", query: "vaults", fetchedAt: timestamp } as const;
const asset = { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 } as const;

function candidate(address: MorphoVaultCandidate["vaultAddress"], netApy: number | null): MorphoVaultCandidate {
  return {
    version: "v1", vaultAddress: address, name: "Vault", symbol: "USDC vault", listed: true,
    chainId: 8453, asset, curatorAddress: null, grossApy: netApy,
    netApy, feeRate: null, totalAssetsRaw: "1", liquidityRaw: "1", stateAsOf: timestamp,
    blockNumber: "1", source,
  };
}

function result(candidates: MorphoVaultCandidate[]): MorphoVaultsResult {
  return { version: "v1", chainId: 8453, asset, candidates, source, stale: false };
}

describe("last known savings rates", () => {
  test("retains only matching vault and asset fields, including the timestamps that expire", () => {
    const a = candidate(MORPHO_V1_CANDIDATE_ADDRESSES[0], 0.04);
    const b = candidate(MORPHO_V1_CANDIDATE_ADDRESSES[1], 0.06);
    const next = result([
      { ...a, vaultAddress: a.vaultAddress.toUpperCase() as MorphoVaultCandidate["vaultAddress"],
        netApy: null, grossApy: null, stateAsOf: null, source: { ...source, fetchedAt: "2026-09-10T12:10:00.000Z" }, name: "New name" },
      { ...b, netApy: null },
    ]);
    const retained = retainLastKnownSavingsRates(result([a]), next);
    expect(retained.candidates[0]).toMatchObject({
      name: "New name", netApy: 0.04, grossApy: 0.04,
      stateAsOf: timestamp, source,
    });
    expect(retained.candidates[1]?.netApy).toBeNull();
    expect(next.candidates[0]?.netApy).toBeNull();
    expect(retainLastKnownSavingsRates(result([a]), result([{ ...a, asset: { ...asset, decimals: 18 } as unknown as MorphoVaultCandidate["asset"], netApy: null }])).candidates[0]?.netApy).toBeNull();
    expect(retainLastKnownSavingsRates(result([a]), result([{ ...a, asset: { ...asset, symbol: "OTHER" as "USDC" }, netApy: null }])).candidates[0]?.netApy).toBeNull();
    expect(retainLastKnownSavingsRates(result([a]), result([{ ...a, asset: { ...asset, address: MORPHO_V1_CANDIDATE_ADDRESSES[2] }, netApy: null }])).candidates[0]?.netApy).toBeNull();
  });

  test("a numeric replacement without a complete observation keeps the prior usable rate", () => {
    const now = Date.parse(timestamp);
    const a = candidate(MORPHO_V1_CANDIDATE_ADDRESSES[0], 0.04);
    for (const incomplete of [
      { ...a, netApy: 0.05, stateAsOf: null },
      { ...a, netApy: 0.05, stateAsOf: "not a date" },
      { ...a, netApy: 0.05, stateAsOf: "2026-09-11T12:00:00.000Z" },
    ]) {
      expect(retainLastKnownSavingsRates(result([a]), result([incomplete]), now).candidates[0]).toMatchObject({
        netApy: 0.04, stateAsOf: timestamp,
      });
    }
    expect(retainLastKnownSavingsRates(result([{ ...a, stateAsOf: null }]), result([{ ...a, netApy: null }]), now).candidates[0]?.netApy).toBeNull();
  });

  test("recovery replaces retained values; zero is valid; invalid prior rates never propagate", () => {
    const a = candidate(MORPHO_V1_CANDIDATE_ADDRESSES[0], 0.04);
    const missing = result([{ ...a, netApy: null }]);
    const retained = retainLastKnownSavingsRates(result([a]), missing);
    expect(retainLastKnownSavingsRates(retained, result([{ ...a, netApy: 0 }])).candidates[0]?.netApy).toBe(0);
    expect(retainLastKnownSavingsRates(missing, missing).candidates[0]?.netApy).toBeNull();
    expect(retainLastKnownSavingsRates(result([{ ...a, netApy: -1 }]), missing).candidates[0]?.netApy).toBeNull();
    expect(retainLastKnownSavingsRates(result([{ ...a, netApy: Number.NaN }]), missing).candidates[0]?.netApy).toBeNull();
  });
});
