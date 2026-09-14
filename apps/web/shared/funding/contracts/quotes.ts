// Route contract.
// POST /api/funding/quotes

import type { Quote } from "@/shared/funding/provider-contract";

export type FundingQuote = Quote;
export type FundingQuoteRequest = {
  providerId: string;
  region: string;
  paymentMethod: string;
  fiatAmount: string;
  kycFields?: Record<string, string>;
};
export type QuoteDraft = { quote: FundingQuote; quoteToken: string; sandbox: boolean };
export type FundingQuoteResponse = QuoteDraft;
export type FundingQuoteErrorCode =
  | "INVALID_QUOTE_REQUEST"
  | "INVALID_KYC_FIELDS"
  | "KYC_REQUIRED"
  | "INVALID_PROVIDER_QUOTE"
  | "QUOTE_UNAVAILABLE"
  | string;

export function readQuoteDraft(value: unknown): QuoteDraft | null { if (!record(value) || typeof value.quoteToken !== "string" || (value.sandbox !== undefined && typeof value.sandbox !== "boolean") || !record(value.quote) || typeof value.quote.fiatAmount !== "string" || typeof value.quote.tokenAmountAtomic !== "string" || !Array.isArray(value.quote.fees) || typeof value.quote.expiresAt !== "string") return null; return { quoteToken: value.quoteToken, quote: value.quote as FundingQuote, sandbox: value.sandbox === true }; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
