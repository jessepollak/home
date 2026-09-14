import { describe, expect, test } from "bun:test";
import { BASE_USDC_ADDRESS } from "@/shared/savings/config";
import type { MorphoVaultCandidate, MorphoVaultsResult } from "@/shared/savings/types";
import { summarizeSavingsPortfolio } from "./portfolio-summary";
import {
  savingsTeaserApyLabel,
  savingsTeaserBalanceLabel,
} from "./savings-teaser-apy";

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
      name: "propagates stale funded rates without blending them",
      input: { balances: ["100000000", "300000000"], rates: [0.04, 0.06], stale: true },
      expected: "APY stale",
    },
    {
      name: "uses the best available rate when positions are zero",
      input: { balances: ["0", "0"], rates: [0.04, 0.06] },
      expected: "Up to 6.00% APY",
    },
    {
      name: "fails closed when a funded contributing rate is unavailable",
      input: { balances: ["100000000", "300000000"], rates: [0.04, null] },
      expected: "APY unavailable",
    },
  ] as const;

  for (const entry of cases) {
    test(entry.name, () => {
      expect(scenario(entry.input).label).toBe(entry.expected);
    });
  }
});

describe("savings teaser balance", () => {
  const funded = scenario({
    balances: ["100000000", "300000000"],
    rates: [0.04, 0.06],
  });

  test("prefers the quote-currency subtotal when available", () => {
    expect(
      savingsTeaserBalanceLabel({
        summary: funded.summary,
        savedSubtotal: "€367.00",
        regionId: "DE",
      }),
    ).toBe("€367.00");
  });

  test("falls back to the authoritative underlying USDC amount", () => {
    expect(
      savingsTeaserBalanceLabel({
        summary: funded.summary,
        savedSubtotal: null,
        regionId: "US",
      }),
    ).toBe("$400.00");
  });

  test("shows a dash only when no balance is available", () => {
    expect(
      savingsTeaserBalanceLabel({
        summary: null,
        savedSubtotal: null,
        regionId: "US",
      }),
    ).toBe("—");
  });
});
