import { isFundingInstruction } from "@/shared/funding/provider-contract";
import { readFundingOrder, type FundingOrderSummary } from "./order";

export const FUNDING_OPEN_ORDER_VERSION = 1 as const;

export function assertFundingOpenOrderResponse(value: unknown, region: string): asserts value is { version: typeof FUNDING_OPEN_ORDER_VERSION; order: FundingOrderSummary | null } {
  if (!record(value) || value.version !== FUNDING_OPEN_ORDER_VERSION || !Object.hasOwn(value, "order") || (value.order !== null && !completeOrder(value, region))) {
    throw new Error("Invalid funding open order response");
  }
}

function completeOrder(value: Record<string, unknown>, region: string): boolean {
  const order = readFundingOrder(value);
  if (!order || !record(value.order)) return false;
  const fields = value.order;
  return (optionalString(fields, "region") && (fields.region === undefined || fields.region === region)) &&
    ["assetId", "paymentMethod", "quoteToken", "createdAt", "updatedAt"].every((key) => optionalString(fields, key)) &&
    optional(fields, "quote", isFundingQuote) &&
    optional(fields, "sandbox", (sandbox) => typeof sandbox === "boolean") &&
    optional(fields, "expectedTokenAmountAtomic", (amount) => amount === null || (typeof amount === "string" && /^(0|[1-9]\d*)$/.test(amount))) &&
    optional(fields, "fees", (fees) => Array.isArray(fees) && fees.every((fee) => record(fee) && typeof fee.label === "string" && typeof fee.amount === "string" && typeof fee.currency === "string")) &&
    optional(fields, "expiresAt", (expiresAt) => expiresAt === null || typeof expiresAt === "string") &&
    optional(fields, "transactionHash", (hash) => hash === null || (typeof hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(hash))) &&
    (order.providerStatus === null || typeof order.providerStatus === "string") &&
    (order.instructions === null || isFundingInstruction(order.instructions));
}

function optionalString(value: Record<string, unknown>, key: string): boolean {
  return optional(value, key, (field) => typeof field === "string");
}

function optional(value: Record<string, unknown>, key: string, valid: (field: unknown) => boolean): boolean {
  return !Object.hasOwn(value, key) || valid(value[key]);
}

function isFundingQuote(value: unknown): boolean {
  return record(value) &&
    optionalString(value, "providerQuoteId") &&
    optional(value, "feesKnown", (known) => typeof known === "boolean") &&
    typeof value.fiatAmount === "string" &&
    typeof value.tokenAmountAtomic === "string" &&
    typeof value.expiresAt === "string" &&
    Array.isArray(value.fees) &&
    value.fees.every((fee) => record(fee) && typeof fee.label === "string" && typeof fee.amount === "string" && typeof fee.currency === "string");
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
