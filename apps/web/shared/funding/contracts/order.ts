import * as z from "zod/mini";
import { fundingQuoteSchema } from "./quotes";
export type { Instruction } from "@/shared/funding/provider-contract";

export const FUNDING_ORDER_VERSION = 1 as const;

const fundingFeesSchema = z.readonly(z.array(z.object({ label: z.string(), amount: z.string(), currency: z.string() })));
const omittedOptionalInstructionKeys = ["accountName", "bank", "alias", "reference"] as const;
const fundingInstructionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("redirect"), url: z.string() }),
  z.object({ kind: z.literal("embed"), url: z.string(), presentation: z.literal("apple-pay"), amount: z.string(), currency: z.string() }),
  z.object({
    kind: z.literal("bank-transfer"), rail: z.string(), accountNumber: z.string(),
    accountName: z.optional(z.string()), bank: z.optional(z.string()), alias: z.optional(z.string()), reference: z.optional(z.string()),
    amount: z.string(), currency: z.string(),
  }).check(z.refine((value) => omittedOptionalInstructionKeys.every((key) =>
    !Object.hasOwn(value, key) || value[key] !== undefined))),
  z.object({ kind: z.literal("qr"), scheme: z.enum(["pix", "qris", "promptpay", "other"]), payload: z.string(), amount: z.string(), currency: z.string() }),
  z.object({ kind: z.literal("payment-key"), scheme: z.string(), key: z.string(), amount: z.string(), currency: z.string() }),
]);
const fundingOrderSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  region: z.optional(z.string()),
  assetId: z.optional(z.string()),
  paymentMethod: z.optional(z.string()),
  state: z.string(),
  fiatAmount: z.string().check(z.regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/)),
  quote: z.optional(fundingQuoteSchema.check(z.refine((value) =>
    (!Object.hasOwn(value, "providerQuoteId") || value.providerQuoteId !== undefined) &&
    (!Object.hasOwn(value, "feesKnown") || value.feesKnown !== undefined)))),
  quoteToken: z.optional(z.string()),
  sandbox: z.optional(z.boolean()),
  expectedTokenAmountAtomic: z.optional(z.nullable(z.string().check(z.regex(/^(?:0|[1-9][0-9]*)$/)))),
  fees: z.optional(fundingFeesSchema),
  expiresAt: z.optional(z.nullable(z.string())),
  providerStatus: z.nullable(z.string()),
  instructions: z.nullable(fundingInstructionSchema),
  transactionHash: z.optional(z.nullable(z.templateLiteral(["0x", z.string()]).check(z.regex(/^0x[0-9a-fA-F]{64}$/)))),
  createdAt: z.optional(z.string()),
  updatedAt: z.optional(z.string()),
  abandonReason: z.optional(z.nullable(z.enum(["owner", "timed-out"]))),
});
const fundingOrderEnvelopeSchema = z.object({ order: fundingOrderSchema });
const fundingOrderResponseSchema = z.object({ version: z.literal(FUNDING_ORDER_VERSION), order: fundingOrderSchema });

export type FundingOrderSummary = z.output<typeof fundingOrderSchema>;

export function isFundingOrderSummary(value: unknown): value is FundingOrderSummary {
  return fundingOrderSchema.safeParse(value).success;
}
function isFundingOrderEnvelope(value: unknown): value is { order: FundingOrderSummary } {
  return fundingOrderEnvelopeSchema.safeParse(value).success;
}
function isFundingOrderResponseEnvelope(value: unknown): value is { order: FundingOrderSummary } {
  return fundingOrderResponseSchema.safeParse(value).success;
}
export function readFundingOrder(value: unknown): FundingOrderSummary | null {
  return isFundingOrderEnvelope(value) ? value.order : null;
}
export function readFundingOrderResponse(value: unknown): FundingOrderSummary | null {
  return isFundingOrderResponseEnvelope(value) ? value.order : null;
}
