import * as z from "zod/mini";

export const FUNDING_QUOTE_VERSION = 1 as const;

const fundingQuoteSchema = z.object({
  providerQuoteId: z.optional(z.string()),
  fiatAmount: z.string(),
  tokenAmountAtomic: z.string(),
  fees: z.array(z.object({ label: z.string(), amount: z.string(), currency: z.string() })),
  feesKnown: z.optional(z.boolean()),
  expiresAt: z.string(),
});

const quoteDraftSchema = z.object({
  version: z.literal(FUNDING_QUOTE_VERSION),
  quote: fundingQuoteSchema,
  quoteToken: z.string(),
  sandbox: z._default(z.boolean(), false),
});

export type FundingQuote = z.output<typeof fundingQuoteSchema>;
export type QuoteDraft = z.output<typeof quoteDraftSchema>;


export function readFundingQuote(value: unknown): FundingQuote | null {
  const result = fundingQuoteSchema.safeParse(value);
  return result.success ? result.data : null;
}
export function readQuoteDraft(value: unknown): QuoteDraft | null {
  const result = quoteDraftSchema.safeParse(value);
  return result.success ? result.data : null;
}
