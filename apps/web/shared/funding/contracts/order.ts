// Route contract.
// GET /api/funding/orders/:id

import type { Instruction, OrderState, Quote } from "@/shared/funding/provider-contract";
export type { Instruction } from "@/shared/funding/provider-contract";

export type FundingOrderSummary = {
  id: string;
  providerId: string;
  region?: string;
  assetId?: string;
  paymentMethod?: string;
  state: OrderState | string;
  fiatAmount: string;
  quote?: Quote;
  quoteToken?: string;
  expectedTokenAmountAtomic?: string | null;
  fees?: ReadonlyArray<{ label: string; amount: string; currency: string }>;
  expiresAt?: string | null;
  providerStatus: string | null;
  instructions: Instruction | null;
  transactionHash?: `0x${string}` | null;
  createdAt?: string;
  updatedAt?: string;
};
export type FundingOrderResponse = { order: FundingOrderSummary };
export type FundingOrderErrorCode = "ORDER_NOT_FOUND" | "ORDER_UNAVAILABLE" | string;

export function readFundingOrder(value: unknown): FundingOrderSummary | null { const candidate = record(value) && record(value.order) ? value.order : null; return candidate && typeof candidate.id === "string" && typeof candidate.providerId === "string" && typeof candidate.state === "string" && typeof candidate.fiatAmount === "string" ? candidate as FundingOrderSummary : null; }
export function readProviderId(value: unknown): string | null { return record(value) && record(value.order) && typeof value.order.providerId === "string" ? value.order.providerId : null; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
