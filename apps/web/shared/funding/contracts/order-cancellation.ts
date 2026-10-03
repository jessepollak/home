import { readFundingOrder, type FundingOrderSummary } from "./order";

export const FUNDING_ORDER_CANCELLATION_VERSION = 1 as const;

export type CancelFundingOrderRequest = {
  version: typeof FUNDING_ORDER_CANCELLATION_VERSION;
};

export type CancelFundingOrderResponse = {
  version: typeof FUNDING_ORDER_CANCELLATION_VERSION;
  order: FundingOrderSummary;
};

export function parseCancelFundingOrderRequest(value: unknown): CancelFundingOrderRequest | null {
  return isRecord(value) && Object.keys(value).length === 1 && value.version === FUNDING_ORDER_CANCELLATION_VERSION
    ? { version: FUNDING_ORDER_CANCELLATION_VERSION } : null;
}

export function readCancelFundingOrderResponse(value: unknown): CancelFundingOrderResponse | null {
  if (!isRecord(value) || value.version !== FUNDING_ORDER_CANCELLATION_VERSION) return null;
  const order = readFundingOrder(value);
  return order?.state === "abandoned" ? { version: FUNDING_ORDER_CANCELLATION_VERSION, order } : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
