import { describe, expect, test } from "bun:test";
import type { RegionId } from "@/config/regions";
import { BASE_USDC_ADDRESS } from "@/shared/savings/config";
import type { MorphoVaultCandidate } from "@/shared/savings/types";
import {
  formatExactSavingsApy,
  getSavingsRateState,
  summarizeSavingsPortfolio,
  type ExactSavingsApy,
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
      position: balances[vaultAddress] === null
        ? null
        : { assetsRaw: balances[vaultAddress] ?? "0" },
    })),
    metadataFetchedAt: "2026-09-10T12:00:00.000Z",
    nowMs: TEST_NOW,
  };
}

describe("savings portfolio summary", () => {
  test("formats exact APY with half-up rounding and regional separators", () => {
    const huge = BigInt(10) ** BigInt(30);
    const cases: Array<{
      name: string;
      value: ExactSavingsApy;
      regionId?: RegionId;
      expected: string;
    }> = [
      { name: "fractional rounding", value: { numerator: BigInt(1), denominator: BigInt(3) }, expected: "33.33%" },
      { name: "half-up boundary", value: { numerator: BigInt(4075), denominator: BigInt(100000) }, expected: "4.08%" },
      { name: "below half-up boundary", value: { numerator: BigInt(40749), denominator: BigInt(1000000) }, expected: "4.07%" },
      { name: "trailing hundredth zero", value: { numerator: BigInt(11), denominator: BigInt(200) }, expected: "5.50%" },
      { name: "two trailing zeros", value: { numerator: BigInt(1), denominator: BigInt(25) }, expected: "4.00%" },
      { name: "GLOBAL grouping", value: { numerator: BigInt(12345), denominator: BigInt(1) }, expected: "1,234,500.00%" },
      { name: "DE grouping", value: { numerator: BigInt(12345), denominator: BigInt(1) }, regionId: "DE", expected: "1.234.500,00\u00a0%" },
      { name: "FR narrow-space grouping", value: { numerator: BigInt(12345), denominator: BigInt(1) }, regionId: "FR", expected: "1\u202f234\u202f500,00\u00a0%" },
      { name: "TR percent prefix", value: { numerator: BigInt(12345), denominator: BigInt(1) }, regionId: "TR", expected: "%1.234.500,00" },
      { name: "huge ratio", value: { numerator: huge + BigInt(1), denominator: huge }, expected: "100.00%" },
      { name: "huge whole percent", value: { numerator: huge + BigInt(1), denominator: BigInt(1) }, expected: "100,000,000,000,000,000,000,000,000,000,100.00%" },
      { name: "overflow", value: { numerator: BigInt(10) ** BigInt(309), denominator: BigInt(1) }, expected: "—" },
      { name: "zero", value: { numerator: BigInt(0), denominator: BigInt(1) }, expected: "0%" },
      { name: "Turkish zero", value: { numerator: BigInt(0), denominator: BigInt(1) }, regionId: "TR", expected: "%0" },
      { name: "German zero", value: { numerator: BigInt(0), denominator: BigInt(1) }, regionId: "DE", expected: "0\u00a0%" },
      { name: "Turkish rounded-to-zero", value: { numerator: BigInt(1), denominator: BigInt(20001) }, regionId: "TR", expected: "%0" },
      { name: "German rounded-to-zero", value: { numerator: BigInt(1), denominator: BigInt(20001) }, regionId: "DE", expected: "0\u00a0%" },
      { name: "rounded nonzero preserves precision", value: { numerator: BigInt(1), denominator: BigInt(20000) }, regionId: "DE", expected: "0,01\u00a0%" },
      { name: "invalid denominator", value: { numerator: BigInt(1), denominator: BigInt(0) }, expected: "—" },
      { name: "negative denominator", value: { numerator: BigInt(1), denominator: BigInt(-1) }, expected: "—" },
      { name: "negative numerator", value: { numerator: BigInt(-1), denominator: BigInt(1) }, expected: "—" },
    ];

    for (const { name, value, regionId, expected } of cases) {
      expect(formatExactSavingsApy(value, regionId), name).toBe(expected);
    }
  });

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

  test("keeps stale funded rates numeric while missing and negative rates remain incomplete", () => {
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
    if (stale.apy.status !== "stale") throw new Error("Expected retained APY");
    expect(formatExactSavingsApy(stale.apy.value)).toBe("4.00%");

    const mixed = input(
      { [VAULT_A]: "100000000", [VAULT_B]: "300000000" },
      { [VAULT_A]: 0.04, [VAULT_B]: 0.06 },
    );
    mixed.candidates = mixed.candidates.map((entry) =>
      entry.vaultAddress === VAULT_A
        ? { ...entry, source: { ...entry.source, fetchedAt: new Date(TEST_NOW - 6 * 60_000).toISOString() } }
        : entry
    );
    const weighted = summarizeSavingsPortfolio(mixed);
    expect(weighted.apy.status).toBe("stale");
    if (weighted.apy.status !== "stale") throw new Error("Expected weighted retained APY");
    expect(formatExactSavingsApy(weighted.apy.value)).toBe("5.50%");

    mixed.candidates = mixed.candidates.map((entry) =>
      entry.vaultAddress === VAULT_B ? { ...entry, netApy: null } : entry
    );
    expect(summarizeSavingsPortfolio(mixed).apy).toEqual({ status: "partial", value: null });
  });

  test("separates read freshness from Morpho indexed-state age", () => {
    const fresh = candidate(VAULT_A, 0.04);
    const cases = [
      {
        name: "fresh read with a three-hour-old indexed state",
        candidate: { ...fresh, stateAsOf: new Date(TEST_NOW - 3 * 60 * 60_000).toISOString() },
        metadataFetchedAt: new Date(TEST_NOW).toISOString(),
        expected: { status: "available", value: 0.04 },
      },
      {
        name: "six-minute-old source read",
        candidate: { ...fresh, source: { ...fresh.source, fetchedAt: new Date(TEST_NOW - 6 * 60_000).toISOString() } },
        metadataFetchedAt: new Date(TEST_NOW).toISOString(),
        expected: { status: "stale", value: 0.04 },
      },
      {
        name: "twenty-five-hour-old indexed state",
        candidate: { ...fresh, stateAsOf: new Date(TEST_NOW - 25 * 60 * 60_000).toISOString() },
        metadataFetchedAt: new Date(TEST_NOW).toISOString(),
        expected: { status: "stale", value: 0.04 },
      },
      {
        name: "future source skew",
        candidate: { ...fresh, source: { ...fresh.source, fetchedAt: new Date(TEST_NOW + 60_001).toISOString() } },
        metadataFetchedAt: new Date(TEST_NOW).toISOString(),
        expected: { status: "unavailable", value: null },
      },
    ] as const;

    for (const entry of cases) {
      expect(getSavingsRateState(entry.candidate, {
        metadataFetchedAt: entry.metadataFetchedAt,
        nowMs: TEST_NOW,
      }), entry.name).toEqual(entry.expected);
    }

    expect(getSavingsRateState({ ...fresh, stateAsOf: null }, {
      metadataFetchedAt: new Date(TEST_NOW).toISOString(),
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
