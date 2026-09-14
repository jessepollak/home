import type { ActionKind, MoneyActionDraft } from "@/shared/money-actions/types";
import type { MorphoMarketId } from "@/shared/morpho-markets/config";

export type LendOperation = "supply" | "withdraw" | "withdraw-all";

export type LendActionIntent = {
  marketId: MorphoMarketId;
  operation: LendOperation;
  amountBaseUnits?: string;
};

export type LendActionPreparation = {
  draft: MoneyActionDraft;
  summary: {
    operation: LendOperation;
    title: string;
    amount: { symbol: string; decimals: number; amountBaseUnits: string };
    warnings: string[];
    asOf: string;
  };
  fullySimulated: boolean;
  simulationBlockHash: `0x${string}`;
  simulationBlockNumber: string;
  simulationBlockTimestamp: string;
  simulationGap: string | null;
};

export function parseLendActionIntent(value: unknown): LendActionIntent | null {
  if (!isRecord(value) || typeof value.marketId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value.marketId) ||
    !isLendOperation(value.operation) || Object.keys(value).some((key) => !["marketId", "operation", "amountBaseUnits"].includes(key))) return null;
  const hasAmount = value.amountBaseUnits !== undefined;
  if (hasAmount && (typeof value.amountBaseUnits !== "string" || !/^[1-9]\d*$/.test(value.amountBaseUnits))) return null;
  if ((value.operation === "withdraw-all") === hasAmount) return null;
  return {
    marketId: value.marketId.toLowerCase() as MorphoMarketId,
    operation: value.operation,
    ...(hasAmount ? { amountBaseUnits: value.amountBaseUnits as string } : {}),
  };
}

export function actionKindForLendOperation(operation: LendOperation): ActionKind {
  return operation === "supply" ? "lend-supply" : "lend-withdraw";
}

export function isLendOperation(value: unknown): value is LendOperation {
  return value === "supply" || value === "withdraw" || value === "withdraw-all";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
