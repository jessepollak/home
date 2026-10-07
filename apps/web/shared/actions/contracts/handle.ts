import { parseMoneyActionNetworkFee } from "@/shared/money-actions/network-fee";
import { isActionKind } from "@/shared/money-actions/types";
import type { GetActionResponse } from "./get";

export const HANDLE_ACTION_CONTRACT_VERSION = 1 as const;

export type HandleActionRequest = {
  providerHandle?: string;
  transactionHash?: string;
};
export type HandleActionResponse = {
  version: typeof HANDLE_ACTION_CONTRACT_VERSION;
  action: Exclude<GetActionResponse, { calls: unknown }>;
};
function isHandleActionResponse(value: unknown): value is HandleActionResponse {
  if (!isRecord(value) || value.version !== HANDLE_ACTION_CONTRACT_VERSION || !isRecord(value.action)) return false;
  const { id, provider, kind, summary, status, createdAt, confirmedAt, submittedAt, settledAt,
    settledBlockNumber, providerHandle, transactionHash, owner } = value.action;
  return typeof id === "string" && id.length > 0 && id.length <= 64 &&
    typeof provider === "string" && provider.length > 0 && isActionKind(kind) &&
    isRecord(summary) && typeof summary.title === "string" && Array.isArray(summary.amounts) &&
    Array.isArray(summary.warnings) && summary.warnings.every((warning) => typeof warning === "string") &&
    typeof summary.expiresAt === "string" &&
    (summary.quoteId === undefined || typeof summary.quoteId === "string") &&
    (summary.metadata === undefined || isRecord(summary.metadata)) &&
    (summary.signing === undefined || isRecord(summary.signing)) &&
    (summary.networkFee === undefined || parseMoneyActionNetworkFee(summary.networkFee) !== null) &&
    (status === "pending" || status === "unknown" || status === "confirmed" || status === "failed") &&
    isTimestamp(createdAt) && isTimestamp(confirmedAt) &&
    (submittedAt === undefined || isTimestamp(submittedAt)) &&
    (settledAt === undefined || isTimestamp(settledAt)) &&
    (settledBlockNumber === undefined || (typeof settledBlockNumber === "string" && /^(?:0|[1-9][0-9]*)$/.test(settledBlockNumber))) &&
    (providerHandle === undefined || (typeof providerHandle === "string" && providerHandle.length > 0 && providerHandle.length <= 512)) &&
    (transactionHash === undefined || (typeof transactionHash === "string" && transactionHash.length > 0)) &&
    isRecord(owner) && typeof owner.subject === "string" && owner.subject.length > 0 &&
    typeof owner.address === "string" && owner.address.length > 0 && Number.isSafeInteger(owner.chainId) &&
    (owner.accountProvider == null || typeof owner.accountProvider === "string");
}

export function parseHandleActionResponse(value: unknown): HandleActionResponse | null {
  return isHandleActionResponse(value) ? value : null;
}

export const HANDLE_ACTION_ERROR_CODES = ["INVALID_ACTION_HANDLE", "ACTION_NOT_FOUND", "ACTIONS_UNAVAILABLE"] as const;
export type HandleActionErrorCode = (typeof HANDLE_ACTION_ERROR_CODES)[number];
export type HandleActionErrorResponse = { error: { code: HandleActionErrorCode; message: string } };

export function isHandleActionErrorCode(value: unknown): value is HandleActionErrorCode {
  return typeof value === "string" && HANDLE_ACTION_ERROR_CODES.some((code) => code === value);
}

export function parseHandleActionErrorResponse(value: unknown): HandleActionErrorResponse | null {
  if (!isRecord(value) || !isRecord(value.error) ||
    !isHandleActionErrorCode(value.error.code) || typeof value.error.message !== "string") return null;
  return { error: { code: value.error.code, message: value.error.message } };
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
