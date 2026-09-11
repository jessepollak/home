import type { MoneyActionDraft, PreparedMoneyAction } from "@/shared/money-actions/types";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { BorrowAddress } from "./config";

export type BorrowOperation =
  | "supply-collateral"
  | "borrow"
  | "repay"
  | "repay-all"
  | "withdraw-collateral";

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

export type BorrowPreviewRequest = {
  operation: BorrowOperation;
  amount: string;
  snapshotBlockHash: `0x${string}`;
};

export type BorrowPreviewSummary = {
  operation: BorrowOperation;
  title: string;
  amount: {
    symbol: "USDC" | "cbBTC";
    decimals: 6 | 8;
    amountBaseUnits: string;
  };
  warnings: string[];
  asOf: string;
  execution: "ready" | "disabled";
  disabledReason?: string;
};

export type BorrowPreviewResponse =
  | {
      status: "prepared";
      action: PreparedMoneyAction;
      snapshot: BorrowMarketSnapshot;
    }
  | {
      status: "preview-only";
      preview: BorrowPreviewSummary;
      snapshot: BorrowMarketSnapshot;
    };

export type BorrowActionPreparation = {
  draft: MoneyActionDraft;
  summary: Omit<BorrowPreviewSummary, "execution" | "disabledReason">;
  fullySimulated: boolean;
  simulationBlockHash: `0x${string}`;
  simulationBlockNumber: string;
  simulationBlockTimestamp: string;
  simulationGap: string | null;
};

export type IssueBorrowAction = (
  session: VerifiedAccountSession,
  draft: MoneyActionDraft,
) => Promise<PreparedMoneyAction>;
