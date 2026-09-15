import { describe, expect, test } from "bun:test";
import {
  estimateSavingsGrowthBaseUnits,
  parseSavingsSnapshotTime,
  SAVINGS_GROWTH_MAX_ELAPSED_MS,
} from "./estimated-growth";

const T0 = 2_000_000_000_000;

function estimate(overrides: Partial<Parameters<typeof estimateSavingsGrowthBaseUnits>[0]> = {}, nowMs = T0 + 250) {
  return estimateSavingsGrowthBaseUnits({
    authoritativeBaseUnits: BigInt("1000000000000000000"),
    apy: { numerator: BigInt(5), denominator: BigInt(100) },
    snapshotTimeMs: T0,
    eligibleUntilMs: T0 + SAVINGS_GROWTH_MAX_ELAPSED_MS,
    ...overrides,
  }, nowMs);
}

describe("estimated Save growth math", () => {
  test("is exact at t0 and uses the fixed-year compounded delta at known intervals", () => {
    expect(estimate({}, T0)).toBe(BigInt("1000000000000000000"));
    expect(estimate({}, T0 + 60_000)).toBe(BigInt("1000000092827561708"));
    expect(estimate({}, T0 + 300_000)).toBe(BigInt("1000000464137894711"));
  });

  test("quantizes downward without forcing a one-unit increase", () => {
    expect(estimate({ authoritativeBaseUnits: BigInt(1) })).toBe(BigInt(1));
    expect(estimate({ authoritativeBaseUnits: BigInt("100000000") })).toBe(BigInt("100000000"));
    expect(estimate({ authoritativeBaseUnits: BigInt("1000000000000") })).toBeGreaterThan(BigInt("1000000000000"));
  });

  test("rejects malformed, negative, excessive, and zero-denominator APY", () => {
    expect(estimate({ apy: { numerator: BigInt(-1), denominator: BigInt(1) } })).toBe(BigInt("1000000000000000000"));
    expect(estimate({ apy: { numerator: BigInt(11), denominator: BigInt(1) } })).toBe(BigInt("1000000000000000000"));
    expect(estimate({ apy: { numerator: BigInt(1), denominator: BigInt(0) } })).toBe(BigInt("1000000000000000000"));
    expect(estimate({ apy: { numerator: BigInt(10), denominator: BigInt(1) } })).toBeGreaterThan(BigInt("1000000000000000000"));
    const huge = BigInt(10) ** BigInt(200);
    expect(estimate({ apy: { numerator: BigInt(5) * huge, denominator: BigInt(100) * huge } })).toBe(estimate());
  });

  test("rejects rollback, future samples, expiry, excessive elapsed time, and non-finite input", () => {
    expect(estimate({}, T0 - 1)).toBe(BigInt("1000000000000000000"));
    expect(estimate({ snapshotTimeMs: T0 + 1 }, T0)).toBe(BigInt("1000000000000000000"));
    expect(estimate({}, T0 + SAVINGS_GROWTH_MAX_ELAPSED_MS + 1)).toBe(BigInt("1000000000000000000"));
    expect(estimate({ eligibleUntilMs: T0 + 10 }, T0 + 11)).toBe(BigInt("1000000000000000000"));
    expect(estimate({}, Number.POSITIVE_INFINITY)).toBe(BigInt("1000000000000000000"));
  });

  test("keeps zero and balances above Number.MAX_SAFE_INTEGER exact bigint values", () => {
    expect(estimate({ authoritativeBaseUnits: BigInt(0) })).toBe(BigInt(0));
    const large = BigInt(Number.MAX_SAFE_INTEGER) * BigInt(1_000_000);
    const result = estimate({ authoritativeBaseUnits: large });
    expect(typeof result).toBe("bigint");
    expect(result).toBeGreaterThan(large);
    expect(result.toString()).not.toContain("e");
  });

  test("parses only canonical safe chain timestamps", () => {
    expect(parseSavingsSnapshotTime("2000000000")).toBe(T0);
    expect(parseSavingsSnapshotTime("02")).toBeNull();
    expect(parseSavingsSnapshotTime("not-a-time")).toBeNull();
    expect(parseSavingsSnapshotTime("999999999999999999999")).toBeNull();
  });
});
