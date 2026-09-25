import { describe, expect, test } from "bun:test";
import { BASE_USDC_ADDRESS } from "@/shared/savings/config";
import type { MorphoVaultCandidate, MorphoVaultsResult } from "@/shared/savings/types";
import { summarizeSavingsPortfolio } from "./portfolio-summary";
import { savingsTeaserApyLabel } from "./savings-teaser-apy";

const VAULT_A = "0x1111111111111111111111111111111111111111";
const VAULT_B = "0x2222222222222222222222222222222222222222";
const NOW = Date.parse("2026-09-13T12:04:00.000Z");
const FETCHED_AT = "2026-09-13T12:00:00.000Z";
const ASSET = { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 } as const;

function candidate(vaultAddress: string, netApy: number | null): MorphoVaultCandidate {
  return {
    version: "v1",
    vaultAddress: vaultAddress as MorphoVaultCandidate["vaultAddress"],
    name: `Vault ${vaultAddress.slice(-1)}`,
    symbol: "USDC vault",
    listed: true,
    chainId: 8453,
    asset: ASSET,
    curatorAddress: null,
    grossApy: netApy,
    netApy,
    feeRate: 0.1,
    totalAssetsRaw: "1",
    liquidityRaw: "1",
    stateAsOf: FETCHED_AT,
    blockNumber: "1",
    source: {
      provider: "Morpho GraphQL",
      endpoint: "https://api.morpho.org/graphql",
      query: "vaults",
      fetchedAt: FETCHED_AT,
    },
  };
}

function scenario({
  balances,
  rates,
  stale = false,
}: {
  balances: readonly [string, string];
  rates: readonly [number | null, number | null];
  stale?: boolean;
}) {
  const candidates = [candidate(VAULT_A, rates[0]), candidate(VAULT_B, rates[1])];
  const metadata = {
    version: "v1",
    chainId: 8453,
    asset: ASSET,
    candidates,
    source: candidates[0]!.source,
    stale,
  } satisfies MorphoVaultsResult;
  const summary = summarizeSavingsPortfolio({
    supportedVaultAddresses: [VAULT_A, VAULT_B],
    requiredAsset: ASSET,
    candidates,
    positions: [VAULT_A, VAULT_B].map((vaultAddress, index) => ({
      vaultAddress,
      position: balances[index] === "0" ? null : { assetsRaw: balances[index]! },
    })),
    metadataFetchedAt: FETCHED_AT,
    metadataStale: stale,
    nowMs: NOW,
  });
  return {
    label: savingsTeaserApyLabel({ summary, candidates, metadata, nowMs: NOW }),
    summary,
  };
}

describe("savings teaser APY", () => {
  const cases = [
    {
      name: "weights funded positions with exact integer balance math",
      input: { balances: ["100000000", "300000000"], rates: [0.04, 0.06] },
      expected: "5.50% APY",
    },
    {
      name: "keeps the weighted funded rate when metadata is stale",
      input: { balances: ["100000000", "300000000"], rates: [0.04, 0.06], stale: true },
      expected: "5.50% APY",
    },
    {
      name: "uses the best available rate when positions are zero",
      input: { balances: ["0", "0"], rates: [0.04, 0.06] },
      expected: "Up to 6.00% APY",
    },
    {
      name: "falls back to the best public offer when a funded rate is incomplete",
      input: { balances: ["100000000", "300000000"], rates: [0.04, null] },
      expected: "Up to 4.00% APY",
    },
  ] as const;

  for (const entry of cases) {
    test(entry.name, () => {
      expect(scenario(entry.input).label).toBe(entry.expected);
    });
  }

  test("keeps numeric stale public offers, including zero, but omits unknown rates", () => {
    const stale = scenario({ balances: ["0", "0"], rates: [0.04, 0.06], stale: true });
    expect(stale.label).toBe("Up to 6.00% APY");
    expect(scenario({ balances: ["0", "0"], rates: [null, null] }).label).toBeNull();
    expect(scenario({ balances: ["0", "0"], rates: [0, null] }).label).toBe("Up to 0% APY");
    expect(scenario({ balances: ["100000000", "1"], rates: [0, 0] }).label).toBe("0% APY");
  });

  test("uses the public offer when account positions are not yet available", () => {
    const metadata = {
      version: "v1",
      chainId: 8453,
      asset: ASSET,
      candidates: [candidate(VAULT_A, 0.04), candidate(VAULT_B, 0.06)],
      source: candidate(VAULT_A, 0.04).source,
      stale: false,
    } satisfies MorphoVaultsResult;

    expect(savingsTeaserApyLabel({
      summary: null,
      candidates: metadata.candidates,
      metadata,
      nowMs: NOW,
    })).toBe("Up to 6.00% APY");
  });
});
