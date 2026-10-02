import { describe, expect, test } from "bun:test";
import type { RegionId } from "@/config/regions";
import { resolveProductOffering, type ProductOffering } from "@/shared/operator-settings/products";
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
  unknownPositions = false,
  regionId = "GLOBAL",
  offering = resolveProductOffering({ kind: "deployment" }),
}: {
  balances: readonly [string, string];
  rates: readonly [number | null, number | null];
  stale?: boolean;
  unknownPositions?: boolean;
  regionId?: RegionId;
  offering?: ProductOffering;
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
      position: unknownPositions ? null : { assetsRaw: balances[index]! },
    })),
    metadataFetchedAt: FETCHED_AT,
    metadataStale: stale,
    nowMs: NOW,
  });
  return {
    label: savingsTeaserApyLabel({ summary, offering, candidates, metadata, nowMs: NOW, regionId }),
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
      name: "does not treat unavailable holdings as an empty portfolio",
      input: { balances: ["0", "0"], rates: [0.04, 0.06], unknownPositions: true },
      expected: null,
    },
    {
      name: "does not substitute a public offer for an incomplete funded rate",
      input: { balances: ["100000000", "300000000"], rates: [0.04, null] },
      expected: null,
    },
  ] as const;

  for (const entry of cases) {
    test(entry.name, () => {
      expect(scenario(entry.input).label).toBe(entry.expected);
    });
  }

  test("uses presentation-region separators for funded and public rates", () => {
    expect(scenario({ balances: ["100000000", "100000000"], rates: [12345, 12345], regionId: "DE" }).label)
      .toBe("1.234.500,00\u00a0% APY");
    expect(scenario({ balances: ["0", "0"], rates: [0.025, 0.035], regionId: "DE" }).label)
      .toBe("Up to 3,50\u00a0% APY");
  });

  test("localizes funded zero and rounded-to-zero APY without losing nonzero precision", () => {
    for (const { regionId, zero, nonzero } of [
      { regionId: "TR", zero: "%0 APY", nonzero: "%0,01 APY" },
      { regionId: "DE", zero: "0\u00a0% APY", nonzero: "0,01\u00a0% APY" },
    ] as const) {
      expect(scenario({ balances: ["100000000", "1"], rates: [0, 0], regionId }).label).toBe(zero);
      expect(scenario({ balances: ["100000000", "1"], rates: [0.000049, 0.000049], regionId }).label).toBe(zero);
      expect(scenario({ balances: ["100000000", "1"], rates: [0.00005, 0.00005], regionId }).label).toBe(nonzero);
      expect(scenario({ balances: ["100000000", "1"], rates: [null, null], regionId }).label).toBeNull();
    }
  });

  test("hides the unfunded public offer when Save is exit-only but keeps funded APY", () => {
    const offering = resolveProductOffering({
      kind: "saved",
      value: {
        products: { save: "exit-only", borrow: "on", invest: "on", send: "on" },
        vaults: {},
        markets: {},
      },
    });
    expect(scenario({ balances: ["0", "0"], rates: [0.04, 0.06], offering }).label).toBeNull();
    expect(scenario({ balances: ["100000000", "300000000"], rates: [0.04, 0.06], offering }).label).toBe("5.50% APY");
  });

  test("keeps numeric stale public offers, including zero, but omits unknown rates", () => {
    const stale = scenario({ balances: ["0", "0"], rates: [0.04, 0.06], stale: true });
    expect(stale.label).toBe("Up to 6.00% APY");
    expect(scenario({ balances: ["0", "0"], rates: [null, null] }).label).toBeNull();
    expect(scenario({ balances: ["0", "0"], rates: [0, null] }).label).toBe("Up to 0% APY");
    expect(scenario({ balances: ["100000000", "1"], rates: [0, 0] }).label).toBe("0% APY");
  });

  test("uses the public offer without an owner portfolio", () => {
    const metadata = {
      version: "v1",
      chainId: 8453,
      asset: ASSET,
      candidates: [candidate(VAULT_A, 0.04), candidate(VAULT_B, 0.06)],
      source: candidate(VAULT_A, 0.04).source,
      stale: false,
    } satisfies MorphoVaultsResult;

    expect(savingsTeaserApyLabel({
      regionId: "GLOBAL",
      summary: null,
      offering: resolveProductOffering({ kind: "deployment" }),
      candidates: metadata.candidates,
      metadata,
      nowMs: NOW,
    })).toBe("Up to 6.00% APY");
  });
});
