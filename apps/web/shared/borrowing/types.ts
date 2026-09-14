import type { ActionKind, MoneyActionDraft, PreparedMoneyAction } from "@/shared/money-actions/types";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { BorrowMarketSnapshot } from "@/shared/borrowing/contract";
import type { BorrowAssetRef, BorrowMarketId } from "./config";

export type BorrowOperation =
  | "supply-collateral"
  | "borrow"
  | "supply-and-borrow"
  | "repay"
  | "repay-all"
  | "withdraw-collateral"
  | "close-position";

export type BorrowActionIntent = {
  marketId: BorrowMarketId;
  operation: BorrowOperation;
  amountBaseUnits?: string;
  collateralAmountBaseUnits?: string;
  maximumRepayBaseUnits?: string;
};

/** Kept as an alias for callers while the generic action contract replaces the old snapshot-bound preview. */
export type BorrowPreviewRequest = BorrowActionIntent;

export type BorrowActionSummaryMetadata = {
  product: "borrow";
  operation: BorrowOperation;
  marketId: BorrowMarketId;
  loanAsset: Pick<BorrowAssetRef, "id" | "symbol">;
  collateralAsset: Pick<BorrowAssetRef, "id" | "symbol">;
  projectedHealthFactorWad: string | null;
  projectedLiquidationPriceRaw: string | null;
  borrowAprWad: string;
  source: {
    blockNumber: string;
    blockHash: `0x${string}`;
    blockTimestamp: string;
  };
};

export type BorrowPreviewSummary = {
  operation: BorrowOperation;
  title: string;
  amount: {
    symbol: string;
    decimals: number;
    amountBaseUnits: string;
  };
  warnings: string[];
  asOf: string;
  execution: "ready" | "disabled";
  disabledReason?: string;
};

export type BorrowPreviewResponse =
  | { status: "prepared"; action: PreparedMoneyAction; snapshot: BorrowMarketSnapshot }
  | { status: "preview-only"; preview: BorrowPreviewSummary; snapshot: BorrowMarketSnapshot };

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

export function parseBorrowActionIntent(value: unknown): BorrowActionIntent | null {
  if (!isRecord(value) || typeof value.marketId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value.marketId) ||
    !isBorrowOperation(value.operation)) return null;
  const allowed = new Set(["marketId", "operation", "amountBaseUnits", "collateralAmountBaseUnits", "maximumRepayBaseUnits"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return null;
  for (const field of ["amountBaseUnits", "collateralAmountBaseUnits", "maximumRepayBaseUnits"] as const) {
    if (value[field] !== undefined && (typeof value[field] !== "string" || !/^(?:0|[1-9]\d*)$/.test(value[field]))) return null;
  }
  const hasAmount = value.amountBaseUnits !== undefined;
  const hasCollateral = value.collateralAmountBaseUnits !== undefined;
  const hasMaximum = value.maximumRepayBaseUnits !== undefined;
  const validShape = value.operation === "supply-and-borrow"
    ? hasAmount && hasCollateral && !hasMaximum
    : value.operation === "repay-all" || value.operation === "close-position"
      ? !hasAmount && !hasCollateral && hasMaximum
      : hasAmount && !hasCollateral && !hasMaximum;
  if (!validShape) return null;
  return {
    marketId: value.marketId.toLowerCase() as BorrowMarketId,
    operation: value.operation,
    ...(hasAmount ? { amountBaseUnits: value.amountBaseUnits as string } : {}),
    ...(hasCollateral ? { collateralAmountBaseUnits: value.collateralAmountBaseUnits as string } : {}),
    ...(hasMaximum ? { maximumRepayBaseUnits: value.maximumRepayBaseUnits as string } : {}),
  };
}

export function isBorrowOperation(value: unknown): value is BorrowOperation {
  return value === "supply-collateral" || value === "borrow" || value === "supply-and-borrow" ||
    value === "repay" || value === "repay-all" || value === "withdraw-collateral" || value === "close-position";
}

export function actionKindForBorrowOperation(operation: BorrowOperation): ActionKind {
  if (operation === "supply-and-borrow") return "borrow";
  if (operation === "repay-all" || operation === "close-position") return "repay";
  return operation;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
