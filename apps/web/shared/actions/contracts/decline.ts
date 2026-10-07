import { parsePresentedAction, type PresentedAction } from "./get";

export const DECLINE_ACTION_CONTRACT_VERSION = 1 as const;

export type DeclineActionRequest = { version: typeof DECLINE_ACTION_CONTRACT_VERSION; attempt: number };
export type DeclineActionResponse = {
  version: typeof DECLINE_ACTION_CONTRACT_VERSION;
  action: PresentedAction;
};
export type DeclineActionErrorCode = "INVALID_ACTION" | "INVALID_ACTION_DECLINE" | "ACTION_NOT_FOUND" | "ACTIONS_UNAVAILABLE";

export function parseDeclineActionRequest(value: unknown): DeclineActionRequest | null {
  if (!isRecord(value) || value.version !== DECLINE_ACTION_CONTRACT_VERSION ||
    !Number.isSafeInteger(value.attempt) || (value.attempt as number) < 0 || (value.attempt as number) > 1000 ||
    Object.keys(value).length !== 2) return null;
  return { version: DECLINE_ACTION_CONTRACT_VERSION, attempt: value.attempt as number };
}

export function parseDeclineActionResponse(value: unknown): DeclineActionResponse | null {
  if (!isRecord(value) || value.version !== DECLINE_ACTION_CONTRACT_VERSION ||
    !parsePresentedAction(value.action)) return null;
  return value as DeclineActionResponse;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
