import * as z from "zod/mini";

export const FUNDING_PROVIDER_CUSTOMERS_VERSION = 1 as const;

const providerCustomerSchema = z.object({
  providerId: z.string(),
  region: z.string(),
  state: z.enum(["reserving", "pending", "verified", "rejected", "dispatch-ambiguous"]),
  verificationStartedAt: z.nullable(z.string()),
  updatedAt: z.string(),
});
const providerCustomersEnvelopeSchema = z.object({ customers: z.array(z.unknown()) });
const providerCustomerEnvelopeSchema = z.object({ customer: providerCustomerSchema });
const providerCustomersResponseSchema = z.object({
  version: z.literal(FUNDING_PROVIDER_CUSTOMERS_VERSION),
  customers: z.array(providerCustomerSchema),
});
const verificationHandoffResponseSchema = z.object({
  version: z.literal(FUNDING_PROVIDER_CUSTOMERS_VERSION),
  handoff: z.object({ url: z.string().check(z.maxLength(4096)) }),
});
const verificationResponseSchema = z.object({
  version: z.literal(FUNDING_PROVIDER_CUSTOMERS_VERSION),
  customer: providerCustomerSchema,
  handoff: z.optional(z.object({ url: z.string().check(z.maxLength(4096)) })),
});

export type FundingProviderCustomerSummary = z.output<typeof providerCustomerSchema>;

export function assertFundingProviderCustomersResponse(value: unknown, region: string): asserts value is { version: typeof FUNDING_PROVIDER_CUSTOMERS_VERSION; customers: unknown[] } {
  const result = providerCustomersResponseSchema.safeParse(value);
  if (!result.success || !result.data.customers.every((customer) => customer.region === region)) {
    throw new Error("Invalid funding provider customers response");
  }
}

/** @public validates a parsed customer list against the requested region, for restored and cached values */
export function isFundingCustomerListFor(value: unknown, region: string): value is ReadonlyArray<FundingProviderCustomerSummary> {
  const result = z.array(providerCustomerSchema).safeParse(value);
  return result.success && result.data.every((customer) => customer.region === region);
}

export function readFundingProviderCustomers(value: unknown): ReadonlyArray<FundingProviderCustomerSummary> {
  const result = providerCustomersEnvelopeSchema.safeParse(value);
  if (!result.success) return [];
  return result.data.customers.filter((customer): customer is FundingProviderCustomerSummary => providerCustomerSchema.safeParse(customer).success);
}
function isProviderCustomerEnvelope(value: unknown): value is { customer: FundingProviderCustomerSummary } {
  return providerCustomerEnvelopeSchema.safeParse(value).success;
}
export function readFundingProviderCustomer(value: unknown): FundingProviderCustomerSummary | null {
  return isProviderCustomerEnvelope(value) ? value.customer : null;
}
export function readVerificationHandoff(value: unknown): string | null {
  const result = verificationHandoffResponseSchema.safeParse(value);
  return result.success ? result.data.handoff.url : null;
}
export function readFundingVerificationResponse(value: unknown): { customer: FundingProviderCustomerSummary; handoff: { url: string } | null } | null {
  const result = verificationResponseSchema.safeParse(value);
  return result.success ? { customer: result.data.customer, handoff: result.data.handoff ?? null } : null;
}
