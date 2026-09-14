import { describe, expect, test } from "bun:test";
import {
  WAD,
  accrueMorphoSupplyState,
  netSupplyAprWad,
  toAssetsDown,
  utilizationWad,
} from "./math";

describe("Morpho lending math", () => {
  test("mints protocol fee shares after interest with Morpho down-rounding", () => {
    const accrued = accrueMorphoSupplyState({
      totalSupplyAssets: BigInt("1000000"),
      totalSupplyShares: BigInt("1000000000000"),
      storedBorrowAssets: BigInt("500000"),
      currentBorrowAssets: BigInt("600000"),
      feeWad: WAD / BigInt(10),
    });
    expect(accrued).toEqual({
      currentSupplyAssets: BigInt("1100000"),
      currentSupplyShares: BigInt("1009174312684"),
      feeAmount: BigInt("10000"),
      feeShares: BigInt("9174312684"),
    });
    expect(toAssetsDown(BigInt("100000000000"), accrued.currentSupplyAssets, accrued.currentSupplyShares)).toBe(BigInt("108999"));
  });

  test("bounds utilization and applies utilization plus protocol fee to net supply APR", () => {
    const utilization = utilizationWad(BigInt("600000"), BigInt("1100000"));
    expect(utilization).toBe(BigInt("545454545454545454"));
    expect(netSupplyAprWad(BigInt("200000000000000000"), utilization, WAD / BigInt(10)))
      .toBe(BigInt("98181818181818181"));
    expect(utilizationWad(BigInt(2), BigInt(1))).toBe(WAD);
    expect(utilizationWad(BigInt(0), BigInt(0))).toBe(BigInt(0));
  });
});
