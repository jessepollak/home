import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { calculateSaveDepositShareBound, SavingsActionError, SHARE_PRICE_SCALE } from "./prepare";

const SAVE_SHARE_BOUND_PROPERTY_SEED = 191402;
const NUM_RUNS = 500;
const UINT128_MAX = (BigInt(1) << BigInt(128)) - BigInt(1);
const UINT64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);
const amount = fc.oneof(
  fc.constantFrom(BigInt(1), BigInt(2), BigInt(1_000_000), UINT128_MAX),
  fc.bigInt({ min: BigInt(1), max: UINT128_MAX }),
);
const previewShares = fc.oneof(
  fc.constantFrom(BigInt(2), BigInt(999), BigInt(1000), BigInt(1001), UINT64_MAX),
  fc.bigInt({ min: BigInt(2), max: UINT64_MAX }),
);

describe("Save deposit share bound properties", () => {
  test("minimum shares are the smallest ceiling that covers the deposit within its preview", () => {
    fc.assert(
      fc.property(amount, previewShares, (depositAmount, shares) => {
        const { minimumShares, maxSharePriceE27, floorMin } = calculateSaveDepositShareBound(depositAmount, shares);
        const numerator = depositAmount * SHARE_PRICE_SCALE;
        expect(floorMin).toBe(shares * BigInt(9990) / BigInt(10_000));
        expect(minimumShares * maxSharePriceE27).toBeGreaterThanOrEqual(numerator);
        expect((minimumShares - BigInt(1)) * maxSharePriceE27).toBeLessThan(numerator);
        expect(minimumShares).toBeLessThanOrEqual(shares);
      }),
      {
        seed: SAVE_SHARE_BOUND_PROPERTY_SEED,
        numRuns: NUM_RUNS,
        examples: [[BigInt(1), BigInt(1001)], [BigInt(1), UINT64_MAX], [UINT128_MAX, BigInt(2)]],
      },
    );
  });

  test("nonpositive deposit amounts throw SavingsActionError", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -UINT128_MAX, max: BigInt(0) }), previewShares, (depositAmount, shares) => {
        expect(() => calculateSaveDepositShareBound(depositAmount, shares)).toThrow(SavingsActionError);
      }),
      {
        seed: SAVE_SHARE_BOUND_PROPERTY_SEED,
        numRuns: NUM_RUNS,
        examples: [[BigInt(0), BigInt(2)], [BigInt(-1), UINT64_MAX]],
      },
    );
  });

  test("previews with nonpositive share floors throw SavingsActionError", () => {
    fc.assert(
      fc.property(amount, fc.bigInt({ min: -UINT64_MAX, max: BigInt(1) }), (depositAmount, shares) => {
        expect(() => calculateSaveDepositShareBound(depositAmount, shares)).toThrow(SavingsActionError);
      }),
      {
        seed: SAVE_SHARE_BOUND_PROPERTY_SEED,
        numRuns: NUM_RUNS,
        examples: [[BigInt(1), BigInt(0)], [BigInt(1), BigInt(1)], [BigInt(2), BigInt(-1)]],
      },
    );
  });
});
