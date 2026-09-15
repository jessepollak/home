import type { ExactSavingsApy } from "./portfolio-summary";

export const SAVINGS_GROWTH_YEAR_MS = 31_536_000_000;
export const SAVINGS_GROWTH_MAX_ELAPSED_MS = 5 * 60_000;
const APY_SCALE = BigInt(100_000_000_000_000);
const GROWTH_SCALE = BigInt(1_000_000_000_000_000_000);
const canonicalIntegerPattern = /^(?:0|[1-9][0-9]*)$/;

export type SavingsGrowthEstimate = {
  authoritativeBaseUnits: bigint;
  apy: ExactSavingsApy;
  snapshotTimeMs: number;
  eligibleUntilMs: number;
};

export function isValidSavingsGrowthApy(apy: ExactSavingsApy): boolean {
  return apy.numerator >= BigInt(0) &&
    apy.denominator > BigInt(0) &&
    apy.numerator <= BigInt(10) * apy.denominator;
}

/**
 * Applies a bounded binary64 compounding approximation only at the display
 * boundary. The authoritative amount and all final base-unit arithmetic remain
 * bigint throughout.
 */
export function estimateSavingsGrowthBaseUnits(
  input: SavingsGrowthEstimate,
  nowMs: number,
): bigint {
  const { apy, authoritativeBaseUnits, eligibleUntilMs, snapshotTimeMs } = input;
  if (
    authoritativeBaseUnits <= BigInt(0) ||
    !Number.isFinite(snapshotTimeMs) ||
    !Number.isFinite(nowMs) ||
    nowMs > eligibleUntilMs
  ) {
    return authoritativeBaseUnits;
  }

  const elapsedMs = nowMs - snapshotTimeMs;
  if (
    elapsedMs < 0 ||
    elapsedMs > SAVINGS_GROWTH_MAX_ELAPSED_MS ||
    !isValidSavingsGrowthApy(apy)
  ) {
    return authoritativeBaseUnits;
  }
  if (elapsedMs === 0 || apy.numerator === BigInt(0)) return authoritativeBaseUnits;

  const apyScaled = apy.numerator * APY_SCALE / apy.denominator;
  const annualRate = Number(apyScaled) / Number(APY_SCALE);
  const delta = Math.expm1(Math.log1p(annualRate) * elapsedMs / SAVINGS_GROWTH_YEAR_MS);
  if (
    !Number.isFinite(delta) ||
    delta < 0 ||
    delta * 1e18 > Number.MAX_SAFE_INTEGER
  ) {
    return authoritativeBaseUnits;
  }

  const growthScaled = BigInt(Math.floor(delta * 1e18));
  return authoritativeBaseUnits + authoritativeBaseUnits * growthScaled / GROWTH_SCALE;
}

export function parseSavingsSnapshotTime(timestamp: string): number | null {
  if (!canonicalIntegerPattern.test(timestamp)) return null;
  const value = Number(timestamp) * 1000;
  return Number.isSafeInteger(value) && Number.isFinite(value) ? value : null;
}
