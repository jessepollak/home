import type { MoneyActionOperationStatus } from "./types";

export type ActivityVisibilityInput = {
  status: MoneyActionOperationStatus;
  transactionHash?: string;
  userOperationHash?: string;
};

const preChainHiddenStatuses = new Set<MoneyActionOperationStatus>([
  "rejected",
  "expired",
]);

export function hasOnchainExecutionReference(operation: ActivityVisibilityInput): boolean {
  return isExecutionHash(operation.transactionHash) || isExecutionHash(operation.userOperationHash);
}

export function isActivityVisibleMoneyAction(operation: ActivityVisibilityInput): boolean {
  if (preChainHiddenStatuses.has(operation.status)) return false;
  if (operation.status === "failed" && !hasOnchainExecutionReference(operation)) return false;
  return true;
}

export function visibleActivityMoneyActions<T extends ActivityVisibilityInput>(
  operations: readonly T[],
): T[] {
  return operations.filter(isActivityVisibleMoneyAction);
}

function isExecutionHash(value: string | undefined): boolean {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}
