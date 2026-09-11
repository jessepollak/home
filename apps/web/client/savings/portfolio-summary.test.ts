import { describe, expect, test } from "bun:test";
import { BASE_USDC_ADDRESS } from "@/shared/savings/config";
import type { MorphoVaultCandidate } from "@/shared/savings/types";
import {
  formatExactSavingsApy,
  getSavingsRateState,
  summarizeSavingsPortfolio,
  type SummarizeSavingsPortfolioInput,
} from "./portfolio-summary";

const VAULT_A = "0x1111111111111111111111111111111111111111";
const VAULT_B = "0x2222222222222222222222222222222222222222";
const VAULT_C = "0x3333333333333333333333333333333333333333";
const TEST_NOW = Date.parse("2026-09-10T12:04:00.000Z");
const USDC = {
  address: BASE_USDC_ADDRESS,
  symbol: "USDC",
  decimals: 6,
} as const satisfies MorphoVaultCandidate["asset"];

function candidate(
  vaultAddress: string,
  netApy: number | null,
  asset: MorphoVaultCandidate["asset"] = USDC,
): MorphoVaultCandidate {
  return {
    version: "v1",
    vaultAddress: vaultAddress as MorphoVaultCandidate["vaultAddress"],
    name: `Vault ${vaultAddress.slice(-1)}`,
    symbol: "USDC vault",
    listed: true,
    chainId: 8453,
    asset,
    curatorAddress: null,
    grossApy: netApy,
    netApy,
    feeRate: 0.1,
    totalAssetsRaw: "1",
    liquidityRaw: "1",
    stateAsOf: "2026-09-10T12:00:00.000Z",
    blockNumber: "1",
    source: {
      provider: "Morpho GraphQL",
      endpoint: "https://api.morpho.org/graphql",
      query: "vaults",
      fetchedAt: "2026-09-10T12:00:00.000Z",
    },
  };
}

function input(
  balances: Record<string, string | null>,
  rates: Record<string, number | null>,
): SummarizeSavingsPortfolioInput {
  const supportedVaultAddresses = [VAULT_A, VAULT_B, VAULT_C];
  return {
    supportedVaultAddresses,
    requiredAsset: USDC,
    candidates: supportedVaultAddresses.map((address) => candidate(address, rates[address] ?? null)),
    positions: supportedVaultAddresses.map((vaultAddress) => ({
      vaultAddress,
      position: balances[vaultAddress] === undefined
        ? null
        : { assetsRaw: balances[vaultAddress] ?? null },
    })),
    metadataFetchedAt: "2026-09-10T12:00:00.000Z",
    nowMs: TEST_NOW,
  };
}

describe("savings portfolio summary", () => {
  test("uses exact balance-weighted net APY without subtracting fees again", () => {
    const summary = summarizeSavingsPortfolio(input(
      {
        [VAULT_A]: "100000000",
        [VAULT_B]: "300000000",
      },
      {
        [VAULT_A]: 0.04,
        [VAULT_B]: 0.06,
      },
    ));

    expect(summary.balance).toMatchObject({
      status: "available",
      totalBaseUnits: "400000000",
    });
    expect(summary.apy.status).toBe("available");
    if (summary.apy.status !== "available") throw new Error("Expected exact APY");
    expect(summary.apy.value).toEqual({
      numerator: BigInt("2200000000"),
      denominator: BigInt("40000000000"),
    });
    expect(formatExactSavingsApy(summary.apy.value)).toBe("5.50%");
  });

  test("excludes verified zero balances from APY completeness and weighting", () => {
    const summary = summarizeSavingsPortfolio(input(
      {
        [VAULT_A]: "100000000",
        [VAULT_B]: "0",
      },
      {
        [VAULT_A]: 0.04,
        [VAULT_B]: null,
      },
    ));

    expect(summary.apy.status).toBe("available");
    if (summary.apy.status !== "available") throw new Error("Expected exact APY");
    expect(formatExactSavingsApy(summary.apy.value)).toBe("4.00%");
  });

  test("fails APY closed for missing, negative, and stale funded rates", () => {
    const missing = summarizeSavingsPortfolio(input(
      { [VAULT_A]: "100000000", [VAULT_B]: "300000000" },
      { [VAULT_A]: 0.04, [VAULT_B]: null },
    ));
    expect(missing.apy.status).toBe("partial");

    const invalidInput = input(
      { [VAULT_A]: "100000000" },
      { [VAULT_A]: -0.01 },
    );
    expect(summarizeSavingsPortfolio(invalidInput).apy.status).toBe("unavailable");

    const stale = summarizeSavingsPortfolio({
      ...input({ [VAULT_A]: "100000000" }, { [VAULT_A]: 0.04 }),
      metadataStale: true,
    });
    expect(stale.apy.status).toBe("stale");
  });

  test("uses state and source timestamps for a bounded freshness decision", () => {
    const fresh = candidate(VAULT_A, 0.04);
    expect(getSavingsRateState(fresh, {
      metadataFetchedAt: "2026-09-10T12:00:00.000Z",
      nowMs: TEST_NOW,
    })).toEqual({ status: "available", value: 0.04 });

    const expiredAtBoundary = {
      ...fresh,
      stateAsOf: new Date(TEST_NOW - 5 * 60_000 - 1).toISOString(),
    };
    expect(getSavingsRateState(expiredAtBoundary, {
      metadataFetchedAt: "2026-09-10T12:00:00.000Z",
      nowMs: TEST_NOW,
    })).toEqual({ status: "stale", value: null });

    expect(getSavingsRateState({ ...fresh, stateAsOf: null }, {
      metadataFetchedAt: "2026-09-10T12:00:00.000Z",
      nowMs: TEST_NOW,
    })).toEqual({ status: "unavailable", value: null });
    expect(getSavingsRateState(fresh, {
      metadataFetchedAt: "not-a-timestamp",
      nowMs: TEST_NOW,
    })).toEqual({ status: "unavailable", value: null });
  });

  test("keeps a verified funded balance available while metadata is pending", () => {
    const pending = input({ [VAULT_A]: "100000000" }, { [VAULT_A]: 0.04 });
    pending.candidates = [];
    pending.metadataFetchedAt = null;

    expect(summarizeSavingsPortfolio(pending)).toMatchObject({
      funded: true,
      balance: { status: "available", totalBaseUnits: "100000000" },
      apy: { status: "unavailable", value: null },
    });
  });

  test("treats absent or unreadable positions as incomplete instead of zero", () => {
    const complete = input({ [VAULT_A]: "100000000" }, { [VAULT_A]: 0.04 });
    const absent = summarizeSavingsPortfolio({
      ...complete,
      positions: complete.positions.slice(0, 2),
    });
    expect(absent.balance).toMatchObject({
      status: "unavailable",
      reason: "positions-incomplete",
    });

    const unreadable = summarizeSavingsPortfolio(input(
      { [VAULT_A]: "100000000", [VAULT_B]: null },
      { [VAULT_A]: 0.04, [VAULT_B]: 0.06 },
    ));
    expect(unreadable.balance).toMatchObject({
      status: "unavailable",
      reason: "positions-incomplete",
    });
  });

  test("returns verified complete zero without presenting personal earnings", () => {
    const summary = summarizeSavingsPortfolio(input({}, {}));
    expect(summary).toMatchObject({
      funded: false,
      balance: { status: "available", totalBaseUnits: "0" },
      apy: { status: "unavailable", value: null },
    });
  });

  test("refuses to combine unlike or non-USDC funded assets", () => {
    const summaryInput = input(
      { [VAULT_A]: "100000000", [VAULT_B]: "300000000" },
      { [VAULT_A]: 0.04, [VAULT_B]: 0.06 },
    );
    summaryInput.candidates = [
      candidate(VAULT_A, 0.04),
      candidate(VAULT_B, 0.06, {
        address: "0x4444444444444444444444444444444444444444",
        symbol: "USDC",
        decimals: 6,
      }),
      candidate(VAULT_C, null),
    ];

    expect(summarizeSavingsPortfolio(summaryInput).balance).toMatchObject({
      status: "unavailable",
      reason: "asset-mismatch",
    });
  });
});
