export const FUNDING_PROVIDER_CUSTOMERS_VERSION = 1 as const;
export type FundingProviderCustomerSummary = {
  providerId: string;
  region: string;
  state: "reserving" | "pending" | "verified" | "rejected" | "dispatch-ambiguous";
  verificationStartedAt: string | null;
  updatedAt: string;
};
export function assertFundingProviderCustomersResponse(value: unknown, region: string): asserts value is { version: typeof FUNDING_PROVIDER_CUSTOMERS_VERSION; customers: unknown[] } {
  if (!record(value) || value.version !== FUNDING_PROVIDER_CUSTOMERS_VERSION || !Array.isArray(value.customers) || !value.customers.every((customer) => isCustomer(customer) && customer.region === region)) {
    throw new Error("Invalid funding provider customers response");
  }
}
export function readFundingProviderCustomers(value: unknown): ReadonlyArray<FundingProviderCustomerSummary> {
  if (!record(value) || !Array.isArray(value.customers)) return [];
  return value.customers.filter(isCustomer);
}
export function readFundingProviderCustomer(value: unknown): FundingProviderCustomerSummary | null {
  return record(value) && isCustomer(value.customer) ? value.customer : null;
}
export function readVerificationHandoff(value: unknown): string | null {
  if (!record(value) || !record(value.handoff) || typeof value.handoff.url !== "string" || value.handoff.url.length > 4096) return null;
  return value.handoff.url;
}
function isCustomer(value: unknown): value is FundingProviderCustomerSummary {
  return record(value) && typeof value.providerId === "string" && typeof value.region === "string" && typeof value.state === "string" && ["reserving","pending","verified","rejected","dispatch-ambiguous"].includes(value.state) && (value.verificationStartedAt === null || typeof value.verificationStartedAt === "string") && typeof value.updatedAt === "string";
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
