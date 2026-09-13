// Route contract.
// GET, POST /api/funding/orders

import type { FundingOrderSummary } from "./order";

export type CreateFundingOrderRequest = { quoteToken: string };
export type CreateFundingOrderResponse = { order: FundingOrderSummary };
export type OpenFundingOrderQuery = { region: string };
export type OpenFundingOrderResponse = { order: FundingOrderSummary | null };
export type FundingOrdersErrorCode =
  | "INVALID_ORDER_REQUEST"
  | "INVALID_QUOTE_TOKEN"
  | "INVALID_REGION"
  | "ORDER_STATE_CHANGED"
  | "ORDER_UNAVAILABLE"
  | string;
