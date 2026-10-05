import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  healthFactorWad,
  toAssetsUp,
  toSharesDown,
  toSharesUp,
  VIRTUAL_ASSETS,
  VIRTUAL_SHARES,
} from "./math";

const MORPHO_PROPERTY_SEED = 191401;
const NUM_RUNS = 500;
const UINT128_MAX = (BigInt(1) << BigInt(128)) - BigInt(1);
const uint = fc.oneof(
  fc.constantFrom(BigInt(0), BigInt(1), BigInt(2), VIRTUAL_ASSETS, VIRTUAL_SHARES, BigInt(255), UINT128_MAX),
  fc.bigInt({ min: BigInt(0), max: UINT128_MAX }),
);
const positiveUint = fc.oneof(
  fc.constantFrom(BigInt(1), BigInt(2), VIRTUAL_ASSETS, VIRTUAL_SHARES, UINT128_MAX),
  fc.bigInt({ min: BigInt(1), max: UINT128_MAX }),
);

describe("Morpho integer math properties", () => {
  test("rounding shares up never returns fewer shares than rounding down", () => {
    fc.assert(
      fc.property(uint, uint, uint, (assets, totalAssets, totalShares) => {
        expect(toSharesUp(assets, totalAssets, totalShares)).toBeGreaterThanOrEqual(
          toSharesDown(assets, totalAssets, totalShares),
        );
      }),
      {
        seed: MORPHO_PROPERTY_SEED,
        numRuns: NUM_RUNS,
        examples: [[BigInt(0), BigInt(0), BigInt(0)], [BigInt(1), VIRTUAL_SHARES, BigInt(0)]],
      },
    );
  });

  test("rounding assets to shares and back up never loses assets", () => {
    fc.assert(
      fc.property(uint, uint, uint, (assets, totalAssets, totalShares) => {
        expect(toAssetsUp(toSharesUp(assets, totalAssets, totalShares), totalAssets, totalShares))
          .toBeGreaterThanOrEqual(assets);
      }),
      {
        seed: MORPHO_PROPERTY_SEED,
        numRuns: NUM_RUNS,
        examples: [[BigInt(1), VIRTUAL_SHARES, BigInt(0)], [UINT128_MAX, UINT128_MAX, UINT128_MAX]],
      },
    );
  });

  test("health factor never increases as positive debt increases", () => {
    fc.assert(
      fc.property(uint, positiveUint, positiveUint, (maxDebt, firstDebt, secondDebt) => {
        const lowerDebt = firstDebt < secondDebt ? firstDebt : secondDebt;
        const higherDebt = firstDebt < secondDebt ? secondDebt : firstDebt;
        const lowerDebtHealth = healthFactorWad(maxDebt, lowerDebt);
        const higherDebtHealth = healthFactorWad(maxDebt, higherDebt);
        if (lowerDebtHealth === null || higherDebtHealth === null) throw new Error("Positive debt must yield a health factor.");
        expect(lowerDebtHealth).toBeGreaterThanOrEqual(higherDebtHealth);
      }),
      { seed: MORPHO_PROPERTY_SEED, numRuns: NUM_RUNS, examples: [[BigInt(2), BigInt(1), BigInt(2)]] },
    );
  });

  test("health factor never decreases as maximum debt increases", () => {
    fc.assert(
      fc.property(positiveUint, uint, uint, (debt, firstMaxDebt, secondMaxDebt) => {
        const lowerMaxDebt = firstMaxDebt < secondMaxDebt ? firstMaxDebt : secondMaxDebt;
        const higherMaxDebt = firstMaxDebt < secondMaxDebt ? secondMaxDebt : firstMaxDebt;
        const lowerCapacityHealth = healthFactorWad(lowerMaxDebt, debt);
        const higherCapacityHealth = healthFactorWad(higherMaxDebt, debt);
        if (lowerCapacityHealth === null || higherCapacityHealth === null) throw new Error("Positive debt must yield a health factor.");
        expect(lowerCapacityHealth).toBeLessThanOrEqual(higherCapacityHealth);
      }),
      { seed: MORPHO_PROPERTY_SEED, numRuns: NUM_RUNS, examples: [[BigInt(1), BigInt(0), BigInt(2)]] },
    );
  });

  test("health factor is null if and only if debt is zero", () => {
    fc.assert(
      fc.property(uint, uint, (maxDebt, debt) => {
        expect(healthFactorWad(maxDebt, debt) === null).toBe(debt === BigInt(0));
      }),
      {
        seed: MORPHO_PROPERTY_SEED,
        numRuns: NUM_RUNS,
        examples: [[BigInt(0), BigInt(0)], [BigInt(0), BigInt(1)], [UINT128_MAX, BigInt(0)]],
      },
    );
  });
});
