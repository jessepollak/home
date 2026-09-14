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
import { projectLendingDetail } from "@/server/lending/project";

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
      return projectBorrowSnapshot(snapshot, marketRef);
    },
    simulateBatch(calls, account, blockNumber, expectedBlockHash, signal) {
      return reader.simulateBatch(calls, account, blockNumber, expectedBlockHash, signal);
    },
  };
}

export function projectBorrowSnapshot(
  snapshot: MorphoMarketSnapshot,
  market: BorrowMarketRef,
): BorrowMarketSnapshot {
  const borrowMode = market.availability;
  let lending: BorrowMarketSnapshot["lending"];
  try { lending = projectLendingDetail(snapshot, market); } catch { lending = undefined; }
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
    ...(lending ? { lending } : {}),
  };
}
