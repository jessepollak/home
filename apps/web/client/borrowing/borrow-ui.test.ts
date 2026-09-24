import { describe, expect, test } from "bun:test";
import { MORPHO_BLUE_ADDRESS, VERIFIED_MORPHO_MARKETS } from "@/shared/morpho-markets/config";
import type { BorrowMarketSnapshot } from "@/shared/borrowing/contract";
import type { BorrowOperation } from "@/shared/borrowing/types";
import type { ActionKind } from "@/shared/money-actions/types";
import {
  borrowRiskCopy,
  borrowRiskDescription,
  borrowRiskState,
  buildBorrowPreparedIntent,
} from "./borrow-ui";

const MARKET = VERIFIED_MORPHO_MARKETS[0]!;
const BORROW_MARKET_ID = MARKET.marketId;
const BORROW_LOAN_TOKEN = MARKET.loanToken;
const BORROW_COLLATERAL_TOKEN = MARKET.collateralToken;
const BORROW_ORACLE_ADDRESS = MARKET.oracle;
const BORROW_IRM_ADDRESS = MARKET.irm;
const BORROW_LLTV_WAD = MARKET.lltvWad;
const OWNER = "0x1111111111111111111111111111111111111111" as const;

function snapshot(debtAssetsRaw = "1000000"): BorrowMarketSnapshot {
  return {
    version: "1",
    chainId: 8453,
    walletAddress: OWNER,
    market: {
      id: BORROW_MARKET_ID,
      morpho: MORPHO_BLUE_ADDRESS,
      loanToken: BORROW_LOAN_TOKEN,
      collateralToken: BORROW_COLLATERAL_TOKEN,
      oracle: BORROW_ORACLE_ADDRESS,
      irm: BORROW_IRM_ADDRESS,
      lltvWad: BORROW_LLTV_WAD.toString(),
      rank: 1,
    },
    eligibility: { mode: "enabled", newRisk: true, reason: null },
    source: { provider: "Base JSON-RPC", blockNumber: "100", blockHash: `0x${"ab".repeat(32)}`, blockTimestamp: "1788897600", fetchedAt: "2026-09-13T12:00:00.000Z" },
    state: { oraclePriceRaw: "1", borrowRatePerSecondWad: "1", borrowAprWad: "1", totalSupplyAssetsRaw: "1", totalBorrowAssetsRaw: "1", totalBorrowSharesRaw: "1", liquidityAssetsRaw: "1", lastUpdateTimestamp: "1" },
    wallet: { collateralBalanceRaw: "200", loanBalanceRaw: "300", collateralAllowanceRaw: "0", loanAllowanceRaw: "0" },
    position: { collateralRaw: "100", borrowSharesRaw: debtAssetsRaw === "0" ? "0" : "1", debtAssetsRaw, rawBorrowCapacityAssetsRaw: "5", borrowCapacityAssetsRaw: "4", rawWithdrawableCollateralRaw: "3", withdrawableCollateralRaw: "2", healthFactorWad: debtAssetsRaw === "0" ? null : "1600000000000000000", liquidationPriceRaw: debtAssetsRaw === "0" ? null : "1" },
  };
}

describe("Borrow UI intent mapping", () => {
  const cases: Array<[BorrowOperation, ActionKind, Record<string, string>]> = [
    ["supply-collateral", "supply-collateral", { amountBaseUnits: "10" }],
    ["borrow", "borrow", { amountBaseUnits: "10" }],
    ["supply-and-borrow", "borrow", { amountBaseUnits: "10", collateralAmountBaseUnits: "20" }],
    ["repay", "repay", { amountBaseUnits: "10" }],
    ["repay-all", "repay", { maximumRepayBaseUnits: "10" }],
    ["withdraw-collateral", "withdraw-collateral", { amountBaseUnits: "10" }],
    ["close-position", "repay", { maximumRepayBaseUnits: "10" }],
  ];

  for (const [operation, kind, expectedAmounts] of cases) {
    test(`maps ${operation} to exact bounded intent`, () => {
      const result = buildBorrowPreparedIntent({
        snapshot: snapshot(),
        operation,
        amountBaseUnits: "10",
        collateralAmountBaseUnits: "20",
      });
      expect(result.kind).toBe(kind);
      expect(result.params).toEqual({ marketId: BORROW_MARKET_ID, operation, ...expectedAmounts });
    });
  }

  test.each(["1000000", "1000001"])("routes repay amount %s at or above debt to the reviewed repay-all maximum", (amountBaseUnits) => {
    expect(buildBorrowPreparedIntent({
      snapshot: snapshot(),
      operation: "repay",
      amountBaseUnits,
      maximumRepayBaseUnits: "1000100",
    })).toEqual({
      kind: "repay",
      operation: "repay-all",
      params: { marketId: BORROW_MARKET_ID, operation: "repay-all", maximumRepayBaseUnits: "1000100" },
    });
  });

  test("routes zero-debt close to a full collateral withdrawal", () => {
    expect(buildBorrowPreparedIntent({ snapshot: snapshot("0"), operation: "close-position" })).toEqual({
      kind: "withdraw-collateral",
      operation: "withdraw-collateral",
      params: { marketId: BORROW_MARKET_ID, operation: "withdraw-collateral", amountBaseUnits: "100" },
    });
  });
});

describe("Borrow risk presentation", () => {
  test.each([
    [null, "no-debt", "No debt"],
    ["1600000000000000000", "healthy", "Healthy buffer"],
    ["1400000000000000000", "limited-buffer", "Limited buffer"],
    ["1200000000000000000", "urgent", "Urgent — reduce risk"],
    ["900000000000000000", "liquidatable", "At liquidation risk"],
  ] as const)("classifies %s", (raw, state, copy) => {
    expect(borrowRiskState(raw)).toBe(state);
    expect(borrowRiskCopy(state)).toBe(copy);
    expect(borrowRiskDescription(raw).length).toBeGreaterThan(10);
  });
});
