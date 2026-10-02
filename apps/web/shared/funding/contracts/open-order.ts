import { FUNDING_PROVIDER_ID_PATTERN } from "@/shared/operator-settings/contract";
import { FUNDING_PAYMENT_METHOD_ID_PATTERN } from "../provider-contract";
import { isFundingOrderSummary, readFundingOrder, type FundingOrderSummary } from "./order";

export const FUNDING_OPEN_ORDER_VERSION = 1 as const;
export const FUNDING_ASSET_ID_PATTERN = /^[a-z][a-z0-9:-]{0,63}$/;

export function assertFundingOpenOrderResponse(value: unknown, region: string): asserts value is { version: typeof FUNDING_OPEN_ORDER_VERSION; order: FundingOrderSummary | null } {
  if (!record(value) || value.version !== FUNDING_OPEN_ORDER_VERSION || !Object.hasOwn(value, "order") || (value.order !== null && !isCompleteFundingOrder(value.order, region))) {
    throw new Error("Invalid funding open order response");
  }
}

/** @public the same completeness rule the open-order envelope applies, for restored and cached parsed orders */
export function isCompleteFundingOrder(value: unknown, region: string): value is FundingOrderSummary {
  return isFundingOrderSummary(value) && (value.region === undefined || value.region === region);
}

export type FundingOpenOrderQuery = { region: string; providerId?: string; paymentMethod?: string; assetId?: string };
export type FundingOpenOrderResponse = { version: typeof FUNDING_OPEN_ORDER_VERSION; order: FundingOrderSummary | null };
export type FundingOpenOrderQueryResult =
  | { ok: true; query: FundingOpenOrderQuery }
  | { ok: false; reason: "region" | "provider" | "paymentMethod" | "asset" };

export function fundingOpenOrderPath(query: FundingOpenOrderQuery): string {
  const params = new URLSearchParams({ region: query.region });
  if (query.providerId !== undefined) params.set("providerId", query.providerId);
  if (query.paymentMethod !== undefined) params.set("paymentMethod", query.paymentMethod);
  if (query.assetId !== undefined) params.set("assetId", query.assetId);
  return `/api/funding/orders?${params.toString()}`;
}

export function parseFundingOpenOrderQuery(params: URLSearchParams): FundingOpenOrderQueryResult {
  const region = params.get("region");
  if (!region) return { ok: false, reason: "region" };
  const providerId = params.get("providerId");
  if (providerId !== null && !FUNDING_PROVIDER_ID_PATTERN.test(providerId)) return { ok: false, reason: "provider" };
  const paymentMethod = params.get("paymentMethod");
  if (paymentMethod !== null && (providerId === null || !FUNDING_PAYMENT_METHOD_ID_PATTERN.test(paymentMethod))) {
    return { ok: false, reason: "paymentMethod" };
  }
  const assetId = params.get("assetId");
  if (assetId !== null && (providerId === null || !FUNDING_ASSET_ID_PATTERN.test(assetId))) {
    return { ok: false, reason: "asset" };
  }
  return {
    ok: true,
    query: { region, ...(providerId === null ? {} : { providerId }), ...(paymentMethod === null ? {} : { paymentMethod }), ...(assetId === null ? {} : { assetId }) },
  };
}

export function readFundingOpenOrderResponse(value: unknown): FundingOpenOrderResponse | null {
  if (!record(value) || Object.keys(value).length !== 2 || value.version !== FUNDING_OPEN_ORDER_VERSION || !Object.hasOwn(value, "order")) return null;
  if (value.order === null) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
  const order = readFundingOrder(value);
  return order ? { version: FUNDING_OPEN_ORDER_VERSION, order } : null;
}

export function fundingOrderMatchesQuery(order: FundingOrderSummary, query: FundingOpenOrderQuery): boolean {
  return order.providerId === query.providerId && order.region === query.region &&
    (query.paymentMethod === undefined || order.paymentMethod === query.paymentMethod) &&
    (query.assetId === undefined || order.assetId === query.assetId);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
