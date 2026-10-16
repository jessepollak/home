import { parseAuthBoundaryErrorResponse, type AuthBoundaryErrorResponse } from "@/shared/account/contracts/auth-boundary";

export type PendingTradeErrorResponse = AuthBoundaryErrorResponse;

/** @public parses pending-trade auth-boundary errors for clients */
export function parsePendingTradeErrorResponse(value: unknown): PendingTradeErrorResponse | null {
  return parseAuthBoundaryErrorResponse(value);
}

export type PendingTradeResponse = {
  version: 1;
  trade: null;
};
