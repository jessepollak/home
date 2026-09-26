import type { HandleActionResponse } from "./handle";

export const RETRY_ACTION_CONTRACT_VERSION = 1 as const;

export type RetryActionRequest = { version: typeof RETRY_ACTION_CONTRACT_VERSION; attempt: number };
export type RetryActionResponse = {
  version: typeof RETRY_ACTION_CONTRACT_VERSION;
  action: HandleActionResponse["action"];
};

export function parseRetryActionRequest(value: unknown): RetryActionRequest | null {
  if (!isRecord(value) || value.version !== RETRY_ACTION_CONTRACT_VERSION ||
    !Number.isSafeInteger(value.attempt) || (value.attempt as number) < 1 || (value.attempt as number) > 1000 ||
    Object.keys(value).length !== 2) return null;
  return { version: RETRY_ACTION_CONTRACT_VERSION, attempt: value.attempt as number };
}

export function parseRetryActionResponse(value: unknown): RetryActionResponse | null {
  if (!isRecord(value) || value.version !== RETRY_ACTION_CONTRACT_VERSION ||
    !isRecord(value.action) || typeof value.action.id !== "string") return null;
  return value as RetryActionResponse;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
