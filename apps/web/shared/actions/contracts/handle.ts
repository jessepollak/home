import { parsePresentedAction, type PresentedAction } from "./get";

export const HANDLE_ACTION_CONTRACT_VERSION = 1 as const;

export type HandleActionRequest = {
  providerHandle?: string;
  transactionHash?: string;
};
export type HandleActionResponse = {
  version: typeof HANDLE_ACTION_CONTRACT_VERSION;
  action: PresentedAction;
};

function isHandleActionResponse(value: unknown): value is HandleActionResponse {
  return isRecord(value) && value.version === HANDLE_ACTION_CONTRACT_VERSION && parsePresentedAction(value.action) !== null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
