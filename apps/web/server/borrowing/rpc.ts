import "server-only";

import type { MoneyActionCall } from "@/shared/money-actions/types";
import type { BorrowAddress, BorrowMarketRef } from "@/shared/borrowing/config";
import { BORROW_HEALTH_FLOOR_WAD } from "@/shared/borrowing/config";
import type { BorrowMarketSnapshot } from "@/shared/borrowing/contract";
import {
  availableBorrowAssets,
  borrowCapacityAssets,
  minimumCollateralForHealthFactor,
  policyMaximumDebtAssets,
} from "@/shared/morpho-markets/math";
import {
  createMorphoMarketRpcReader,
  type MorphoMarketRpcReader,
  type MorphoMarketSnapshot,
} from "@/server/morpho-markets/rpc";

export { MorphoMarketRpcError as BorrowRpcError } from "@/server/morpho-markets/rpc";

export type BorrowRpcReader = {
  readSnapshot(account: BorrowAddress, marketRef: BorrowMarketRef, signal?: AbortSignal): Promise<BorrowMarketSnapshot>;
  simulateBatch(
    calls: readonly MoneyActionCall[],
    account: BorrowAddress,
    blockNumber: string,
    expectedBlockHash: `0x${string}`,
    signal?: AbortSignal,
  ): Promise<void>;
};

export function createBorrowRpcReader(options: {
  fetchImpl?: typeof fetch;
  rpcUrl?: string;
  timeoutMs?: number;
  now?: () => Date;
} = {}): BorrowRpcReader {
  const reader = createMorphoMarketRpcReader(options);
  return projectBorrowReader(reader);
}

export const getBaseBorrowing = createBorrowRpcReader();

function projectBorrowReader(reader: MorphoMarketRpcReader): BorrowRpcReader {
  return {
    async readSnapshot(account, marketRef, signal) {
      const snapshot = await reader.readSnapshot(account, marketRef, signal);
      return projectBorrowSnapshot(snapshot, marketRef.availability);
    },
    simulateBatch(calls, account, blockNumber, expectedBlockHash, signal) {
      return reader.simulateBatch(calls, account, blockNumber, expectedBlockHash, signal);
    },
  };
}

function projectBorrowSnapshot(
  snapshot: MorphoMarketSnapshot,
  borrowMode: BorrowMarketRef["availability"],
): BorrowMarketSnapshot {
  const collateral = BigInt(snapshot.position.collateralRaw);
  const debt = BigInt(snapshot.position.debtAssetsRaw);
  const oraclePrice = BigInt(snapshot.state.oraclePriceRaw);
  const totalBorrowAssets = BigInt(snapshot.state.totalBorrowAssetsRaw);
  const totalBorrowShares = BigInt(snapshot.state.totalBorrowSharesRaw);
  const borrowShares = BigInt(snapshot.position.borrowSharesRaw);
  const liquidity = BigInt(snapshot.state.liquidityAssetsRaw);
  const lltvWad = BigInt(snapshot.market.lltvWad);
  const policyMaxDebt = policyMaximumDebtAssets(
    borrowCapacityAssets(collateral, oraclePrice, lltvWad),
    BORROW_HEALTH_FLOOR_WAD,
  );
  const availableBorrow = availableBorrowAssets({
    positionBorrowShares: borrowShares,
    totalBorrowAssets,
    totalBorrowShares,
    maxDebtAssets: policyMaxDebt,
    liquidityAssets: liquidity,
  });
  const policyRequiredCollateral = minimumCollateralForHealthFactor(
    debt,
    oraclePrice,
    lltvWad,
    BORROW_HEALTH_FLOOR_WAD,
  );
  const withdrawableCollateral = collateral > policyRequiredCollateral
    ? collateral - policyRequiredCollateral
    : BigInt("0");

  return {
    chainId: snapshot.chainId,
    walletAddress: snapshot.walletAddress,
    version: "1",
    market: snapshot.market,
    eligibility: {
      mode: borrowMode,
      newRisk: borrowMode === "enabled",
      reason: borrowMode === "enabled" ? null : "This verified market is available only for risk reduction.",
    },
    source: snapshot.source,
    state: {
      oraclePriceRaw: snapshot.state.oraclePriceRaw,
      borrowRatePerSecondWad: snapshot.state.borrowRatePerSecondWad,
      borrowAprWad: snapshot.state.borrowAprWad,
      totalSupplyAssetsRaw: snapshot.state.totalSupplyAssetsRaw,
      totalBorrowAssetsRaw: snapshot.state.totalBorrowAssetsRaw,
      totalBorrowSharesRaw: snapshot.state.totalBorrowSharesRaw,
      liquidityAssetsRaw: snapshot.state.liquidityAssetsRaw,
      lastUpdateTimestamp: snapshot.state.lastUpdateTimestamp,
    },
    wallet: snapshot.wallet,
    position: {
      collateralRaw: snapshot.position.collateralRaw,
      borrowSharesRaw: snapshot.position.borrowSharesRaw,
      debtAssetsRaw: snapshot.position.debtAssetsRaw,
      rawBorrowCapacityAssetsRaw: snapshot.position.availableBorrowAssetsRaw,
      borrowCapacityAssetsRaw: availableBorrow.toString(10),
      rawWithdrawableCollateralRaw: snapshot.position.withdrawableCollateralRaw,
      withdrawableCollateralRaw: withdrawableCollateral.toString(10),
      healthFactorWad: snapshot.position.healthFactorWad,
      liquidationPriceRaw: snapshot.position.liquidationPriceRaw,
    },
    lending: {
      version: "1",
      mode: lendingMode(snapshot.capabilities.lend),
      canSupply: snapshot.capabilities.lend === "enabled",
      canWithdraw: BigInt(snapshot.position.supplySharesRaw) > BigInt(0),
      reason: snapshot.capabilities.lend === "enabled"
        ? null
        : snapshot.capabilities.lend === "reducing-only"
          ? "This verified market permits withdrawal but not new supply."
          : "This verified market is not approved for new lending supply.",
      state: {
        totalSupplyAssetsRaw: snapshot.state.totalSupplyAssetsRaw,
        totalSupplySharesRaw: snapshot.state.totalSupplySharesRaw,
        totalBorrowAssetsRaw: snapshot.state.totalBorrowAssetsRaw,
        liquidityAssetsRaw: snapshot.state.liquidityAssetsRaw,
        feeWad: snapshot.state.feeWad,
        utilizationWad: snapshot.state.utilizationWad,
        supplyAprWad: snapshot.state.supplyAprWad,
      },
      position: {
        supplySharesRaw: snapshot.position.supplySharesRaw,
        suppliedAssetsRaw: snapshot.position.suppliedAssetsRaw,
        withdrawableAssetsRaw: snapshot.position.withdrawableSupplyAssetsRaw,
      },
    },
  };
}

function lendingMode(capability: MorphoMarketSnapshot["capabilities"]["lend"]): "enabled" | "reducing-only" | "withdraw-only" {
  return capability ?? "withdraw-only";
}
