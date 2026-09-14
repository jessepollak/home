import "server-only";

import type { LendingMarketDetail, LendingMarketState } from "@/shared/lending/contract";
import type { VerifiedMorphoMarketRef } from "@/shared/morpho-markets/config";
import type { MorphoMarketSnapshot } from "@/server/morpho-markets/rpc";

export function projectLendingDetail(
  snapshot: MorphoMarketSnapshot,
  market: VerifiedMorphoMarketRef,
): LendingMarketDetail {
  const state = projectLendingState(snapshot);
  const supplySharesRaw = decimal(snapshot.position.supplySharesRaw);
  const suppliedAssetsRaw = decimal(snapshot.position.suppliedAssetsRaw);
  const withdrawableAssetsRaw = decimal(snapshot.position.withdrawableSupplyAssetsRaw);
  const mode = market.capabilities.lend ?? "withdraw-only";
  return {
    version: "1",
    mode,
    canSupply: market.capabilities.lend === "enabled",
    canWithdraw: BigInt(withdrawableAssetsRaw) > BigInt(0),
    reason: market.capabilities.lend === "enabled"
      ? null
      : market.capabilities.lend === "reducing-only"
        ? "This verified market permits withdrawal but not new supply."
        : "This verified market is not approved for new lending supply.",
    state,
    position: { supplySharesRaw, suppliedAssetsRaw, withdrawableAssetsRaw },
  };
}

export function projectLendingState(snapshot: MorphoMarketSnapshot): LendingMarketState {
  return {
    totalSupplyAssetsRaw: decimal(snapshot.state.totalSupplyAssetsRaw),
    totalSupplySharesRaw: decimal(snapshot.state.totalSupplySharesRaw),
    totalBorrowAssetsRaw: decimal(snapshot.state.totalBorrowAssetsRaw),
    liquidityAssetsRaw: decimal(snapshot.state.liquidityAssetsRaw),
    feeWad: decimal(snapshot.state.feeWad),
    utilizationWad: decimal(snapshot.state.utilizationWad),
    supplyAprWad: decimal(snapshot.state.supplyAprWad),
  };
}

function decimal(value: unknown): string {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new TypeError("The generic Morpho snapshot omitted valid lending state.");
  }
  return value;
}
