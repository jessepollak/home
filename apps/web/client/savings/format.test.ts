import { describe, expect, test } from "bun:test";
import { BASE_USDC_ADDRESS, MORPHO_V1_CANDIDATE_ADDRESSES } from "@/shared/savings/config";
import type { MorphoVaultCandidate, MorphoVaultsResult } from "@/shared/savings/types";
import {
  parseUsdcAmount,
  readUsdcBaseUnits,
  savingsVaultApyLabel,
  shortVaultLabel,
} from "./format";

describe("savings format", () => {
  test("shortens vault names", () => {
    expect(shortVaultLabel("Gauntlet USDC Prime")).toBe("Gauntlet");
    expect(shortVaultLabel("Steakhouse USDC")).toBe("Steakhouse");
  });

  test("shows valid APY regardless of freshness and omits unknown rates", () => {
    const timestamp = "2026-09-10T12:00:00.000Z";
    const candidate: MorphoVaultCandidate = {
      version: "v1", vaultAddress: MORPHO_V1_CANDIDATE_ADDRESSES[0],
      name: "Vault", symbol: "USDC vault", listed: true, chainId: 8453,
      asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 },
      curatorAddress: null, grossApy: 0, netApy: 0, feeRate: null,
      totalAssetsRaw: "1", liquidityRaw: "1", stateAsOf: timestamp, blockNumber: "1",
      source: { provider: "Morpho GraphQL", endpoint: "https://api.morpho.org/graphql", query: "vaults", fetchedAt: timestamp },
    };
    const metadata: MorphoVaultsResult = {
      version: "v1", chainId: 8453, asset: candidate.asset, candidates: [candidate],
      source: candidate.source, stale: false,
    };
    const nowMs = Date.parse(timestamp) + 4 * 60_000;
    expect(savingsVaultApyLabel(candidate, metadata, nowMs)).toBe("0% APY");
    expect(savingsVaultApyLabel({ ...candidate, netApy: 0.055 }, { ...metadata, stale: true }, nowMs)).toBe("5.50% APY");
    expect(savingsVaultApyLabel(candidate, metadata, nowMs + 2 * 60_000)).toBe("0% APY");
    expect(savingsVaultApyLabel({ ...candidate, netApy: null }, metadata, nowMs)).toBeNull();
  });

  test("parses dollar amounts into six-decimal USDC base units", () => {
    expect(parseUsdcAmount("100")).toBe("100000000");
    expect(parseUsdcAmount("1.234567")).toBe("1234567");
    expect(readUsdcBaseUnits("820000000")).toBe(BigInt("820000000"));
    expect(readUsdcBaseUnits(null)).toBeNull();
  });
});
