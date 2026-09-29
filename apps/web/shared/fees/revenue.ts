import type { OperatorFeeActionType, OperatorFeeCollection } from "./operator-fee";

export type OperatorFeeResult = "succeeded" | "reverted" | "not_submitted" | "unresolved";

export type OperatorRevenueEntry = {
  actionId: string;
  actionKind: OperatorFeeActionType;
  recordedAt: string;
  amountBaseUnits: string;
  symbol: "USDC";
  decimals: 6;
  bps: number;
  recipient: `0x${string}`;
  collectedBy: OperatorFeeCollection;
  result: OperatorFeeResult;
  transactionHash: `0x${string}` | null;
};

export type OperatorRevenueDay = { date: string; collectedBaseUnits: string };

export type OperatorRevenueSummary = {
  collectedBaseUnits: string;
  days: OperatorRevenueDay[];
  entries: OperatorRevenueEntry[];
};
