// Route contract.
// GET /api/borrow

import type { BorrowAddress } from "./config";
import { BORROW_MARKET_ID, MORPHO_BLUE_ADDRESS } from "./config";

export type BorrowMarketSnapshot = {
  chainId: 8453;
  walletAddress: BorrowAddress;
  market: {
    id: `0x${string}`;
    morpho: BorrowAddress;
    loanToken: typeof import("./config").BORROW_LOAN_TOKEN;
    collateralToken: typeof import("./config").BORROW_COLLATERAL_TOKEN;
    oracle: BorrowAddress;
    irm: BorrowAddress;
    lltvWad: string;
  };
  source: {
    provider: "Base JSON-RPC";
    blockNumber: string;
    blockHash: `0x${string}`;
    blockTimestamp: string;
    fetchedAt: string;
  };
  state: {
    oraclePriceRaw: string;
    borrowRatePerSecondWad: string;
    borrowAprWad: string;
    totalSupplyAssetsRaw: string;
    totalBorrowAssetsRaw: string;
    totalBorrowSharesRaw: string;
    liquidityAssetsRaw: string;
    lastUpdateTimestamp: string;
  };
  wallet: {
    collateralBalanceRaw: string;
    loanBalanceRaw: string;
    collateralAllowanceRaw: string;
    loanAllowanceRaw: string;
  };
  position: {
    collateralRaw: string;
    borrowSharesRaw: string;
    debtAssetsRaw: string;
    borrowCapacityAssetsRaw: string;
    withdrawableCollateralRaw: string;
    healthFactorWad: string | null;
    liquidationPriceRaw: string | null;
  };
};

export type BorrowResponse = BorrowMarketSnapshot;
export type BorrowErrorCode = "SMART_ACCOUNT_UNAVAILABLE" | "BORROW_STATE_UNAVAILABLE";

export function parseSnapshot(value: unknown, expectedOwner: `0x${string}`): BorrowMarketSnapshot | null {
  if (!isRecord(value) || value.chainId !== 8453 || typeof value.walletAddress !== "string" || value.walletAddress.toLowerCase() !== expectedOwner.toLowerCase()) return null;
  if (!isRecord(value.market) || value.market.id !== BORROW_MARKET_ID || typeof value.market.morpho !== "string" || value.market.morpho.toLowerCase() !== MORPHO_BLUE_ADDRESS.toLowerCase()) return null;
  if (!isRecord(value.source) || typeof value.source.blockNumber !== "string" || typeof value.source.blockHash !== "string" || typeof value.source.blockTimestamp !== "string" || !/^0x[0-9a-f]{64}$/.test(value.source.blockHash)) return null;
  if (!isRecord(value.state) || !isRecord(value.wallet) || !isRecord(value.position)) return null;
  const decimalFields = [
    value.source.blockNumber, value.source.blockTimestamp,
    value.state.oraclePriceRaw, value.state.borrowRatePerSecondWad, value.state.borrowAprWad,
    value.state.totalSupplyAssetsRaw, value.state.totalBorrowAssetsRaw, value.state.totalBorrowSharesRaw,
    value.state.liquidityAssetsRaw, value.state.lastUpdateTimestamp,
    value.wallet.collateralBalanceRaw, value.wallet.loanBalanceRaw,
    value.wallet.collateralAllowanceRaw, value.wallet.loanAllowanceRaw,
    value.position.collateralRaw, value.position.borrowSharesRaw, value.position.debtAssetsRaw,
    value.position.borrowCapacityAssetsRaw, value.position.withdrawableCollateralRaw,
  ];
  if (decimalFields.some((field) => typeof field !== "string" || !/^\d+$/.test(field))) return null;
  if (value.position.healthFactorWad !== null && (typeof value.position.healthFactorWad !== "string" || !/^\d+$/.test(value.position.healthFactorWad))) return null;
  if (value.position.liquidationPriceRaw !== null && (typeof value.position.liquidationPriceRaw !== "string" || !/^\d+$/.test(value.position.liquidationPriceRaw))) return null;
  return value as BorrowMarketSnapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
