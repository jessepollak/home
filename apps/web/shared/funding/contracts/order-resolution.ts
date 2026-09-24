import { readFundingOrder, type FundingOrderSummary } from "./order";

export const FUNDING_ORDER_RESOLUTION_VERSION = 1 as const;

export type ResolveFundingOrderRequest = {
  version: typeof FUNDING_ORDER_RESOLUTION_VERSION;
};

export type ResolveFundingOrderResponse = {
  version: typeof FUNDING_ORDER_RESOLUTION_VERSION;
  order: FundingOrderSummary;
};

export function parseResolveFundingOrderRequest(
  value: unknown,
): ResolveFundingOrderRequest | null {
  return isRecord(value) &&
    Object.keys(value).length === 1 &&
    value.version === FUNDING_ORDER_RESOLUTION_VERSION
    ? { version: FUNDING_ORDER_RESOLUTION_VERSION }
    : null;
}

export function readResolveFundingOrderResponse(
  value: unknown,
): ResolveFundingOrderResponse | null {
  if (
    !isRecord(value) ||
    value.version !== FUNDING_ORDER_RESOLUTION_VERSION
  ) return null;
  const order = readFundingOrder(value);
  return order
    ? { version: FUNDING_ORDER_RESOLUTION_VERSION, order }
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
