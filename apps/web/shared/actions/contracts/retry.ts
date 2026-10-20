import { AUTH_BOUNDARY_ERROR_CODES, type AuthBoundaryErrorCode } from "@/shared/account/contracts/auth-boundary";
import { parsePresentedAction, type PresentedAction } from "./get";

export const RETRY_ACTION_CONTRACT_VERSION = 1 as const;

export type RetryActionRequest = { version: typeof RETRY_ACTION_CONTRACT_VERSION; attempt: number };
export type RetryActionResponse = {
  version: typeof RETRY_ACTION_CONTRACT_VERSION;
  action: PresentedAction;
};
export type RetryActionErrorCode = AuthBoundaryErrorCode | "INVALID_ACTION" | "INVALID_ACTION_RETRY" | "ACTION_NOT_FOUND" | "ACTIONS_UNAVAILABLE" |
  "ACTION_EXPIRED" | "ACTION_ALREADY_DISPATCHED" | "ACTION_RETRY_CONFLICT" | "CARD_ALLOWANCE_UNAVAILABLE" | "CARD_ALLOWANCE_NOT_READY";
export const RETRY_ACTION_ERROR_CODES: readonly RetryActionErrorCode[] = [
  ...AUTH_BOUNDARY_ERROR_CODES, "INVALID_ACTION", "INVALID_ACTION_RETRY", "ACTION_NOT_FOUND", "ACTIONS_UNAVAILABLE",
  "ACTION_EXPIRED", "ACTION_ALREADY_DISPATCHED", "ACTION_RETRY_CONFLICT", "CARD_ALLOWANCE_UNAVAILABLE", "CARD_ALLOWANCE_NOT_READY",
];
export type RetryActionErrorResponse = { error: { code: RetryActionErrorCode; message: string } };

export function isRetryActionErrorCode(value: unknown): value is RetryActionErrorCode {
  return typeof value === "string" && RETRY_ACTION_ERROR_CODES.some((code) => code === value);
}

/** @public parses action-retry endpoint errors for clients */
export function parseRetryActionErrorResponse(value: unknown): RetryActionErrorResponse | null {
  if (!isRecord(value) || !isRecord(value.error) || !isRetryActionErrorCode(value.error.code) ||
    typeof value.error.message !== "string" || value.error.message.length === 0) return null;
  return { error: { code: value.error.code, message: value.error.message } };
}

export function parseRetryActionRequest(value: unknown): RetryActionRequest | null {
  if (!isRecord(value) || value.version !== RETRY_ACTION_CONTRACT_VERSION ||
    !Number.isSafeInteger(value.attempt) || (value.attempt as number) < 1 || (value.attempt as number) > 1000 ||
    Object.keys(value).length !== 2) return null;
  return { version: RETRY_ACTION_CONTRACT_VERSION, attempt: value.attempt as number };
}

export function parseRetryActionResponse(value: unknown): RetryActionResponse | null {
  if (!isRecord(value) || value.version !== RETRY_ACTION_CONTRACT_VERSION ||
    !parsePresentedAction(value.action)) return null;
  return value as RetryActionResponse;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
