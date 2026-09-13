import type { MoneyActionDraft, PreparedMoneyAction } from "@/shared/money-actions/types";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { BorrowMarketSnapshot } from "@/shared/borrowing/contract";

export type BorrowOperation =
  | "supply-collateral"
  | "borrow"
  | "repay"
  | "repay-all"
  | "withdraw-collateral";

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
