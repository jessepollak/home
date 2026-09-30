import { describe, expect, test } from "bun:test";
import { BASE_USDC_ADDRESS, MORPHO_V1_CANDIDATE_ADDRESSES } from "@/shared/savings/config";
import type { MorphoVaultCandidate, MorphoVaultsResult } from "@/shared/savings/types";
import { savingsRateLabel } from "./savings-management";

const fetchedAt = "2026-09-10T12:00:00.000Z";
const nowMs = Date.parse("2026-09-10T12:04:00.000Z");
const asset = { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 } as const;
const source = { provider: "Morpho GraphQL", endpoint: "https://api.morpho.org/graphql", query: "vaults", fetchedAt } as const;
const candidate: MorphoVaultCandidate = {
  version: "v1",
  vaultAddress: MORPHO_V1_CANDIDATE_ADDRESSES[0],
  name: "Test vault",
  symbol: "USDC vault",
  listed: true,
  chainId: 8453,
  asset,
  curatorAddress: null,
  grossApy: 0.055,
  netApy: 0.055,
  feeRate: 0,
  totalAssetsRaw: "1",
  liquidityRaw: "1",
  stateAsOf: fetchedAt,
  blockNumber: "1",
  source,
};
const metadata: MorphoVaultsResult = {
  version: "v1",
  chainId: 8453,
  asset,
  candidates: [candidate],
  source,
  stale: false,
};

describe("savings rate label", () => {
  test("formats available APY for the presentation region", () => {
    expect(savingsRateLabel(candidate, metadata, nowMs, "DE")).toBe("5,50\u00a0% APY");
    expect(savingsRateLabel(candidate, metadata, nowMs, "GLOBAL")).toBe("5.50% APY");
  });

  test("keeps unavailable rates unavailable regardless of region", () => {
    expect(savingsRateLabel(null, metadata, nowMs, "DE")).toBe("Rate unavailable");
    expect(savingsRateLabel(candidate, null, nowMs, "DE")).toBe("Rate unavailable");
  });
});
