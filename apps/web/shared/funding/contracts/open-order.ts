import { readFundingOrder, type FundingOrderSummary } from "./order";

export const FUNDING_OPEN_ORDER_VERSION = 1 as const;

export function assertFundingOpenOrderResponse(value: unknown, region: string): asserts value is { version: typeof FUNDING_OPEN_ORDER_VERSION; order: FundingOrderSummary | null } {
  if (!record(value) || value.version !== FUNDING_OPEN_ORDER_VERSION || !Object.hasOwn(value, "order") || (value.order !== null && !completeOrder(value, region))) {
    throw new Error("Invalid funding open order response");
  }
}

function completeOrder(value: Record<string, unknown>, region: string): boolean {
  const order = readFundingOrder(value);
  return order !== null && (order.region === undefined || order.region === region);
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
