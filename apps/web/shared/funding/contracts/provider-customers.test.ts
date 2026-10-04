import { expect, test } from "bun:test";
import { assertFundingProviderCustomersResponse, FUNDING_PROVIDER_CUSTOMERS_VERSION, isFundingCustomerListFor, readFundingProviderCustomer, readFundingProviderCustomers, readVerificationHandoff } from "./provider-customers";

const pending = { providerId: "ripio", region: "AR", state: "pending" as const, verificationStartedAt: null, updatedAt: "now" };

test.each([
  null, {}, { customers: null }, { customers: "invalid" },
  { version: 2, customers: [] },
  { customers: [] },
  { version: FUNDING_PROVIDER_CUSTOMERS_VERSION, customers: [{}] },
  { version: FUNDING_PROVIDER_CUSTOMERS_VERSION, customers: [{ providerId: "partial" }] },
  { version: FUNDING_PROVIDER_CUSTOMERS_VERSION, customers: [pending, { providerId: "partial" }] },
  { version: FUNDING_PROVIDER_CUSTOMERS_VERSION, customers: [{ ...pending, region: "BR" }] },
  { version: FUNDING_PROVIDER_CUSTOMERS_VERSION, customers: [pending, { ...pending, providerId: "idrx", region: "CO" }] },
])("rejects an unknown, stale, partial or foreign-region provider-customers response: %p", (value) => {
  expect(() => assertFundingProviderCustomersResponse(value, "AR")).toThrow("Invalid funding provider customers response");
});

test("accepts a known empty provider-customers response", () => {
  expect(() => assertFundingProviderCustomersResponse({ version: FUNDING_PROVIDER_CUSTOMERS_VERSION, customers: [] }, "AR")).not.toThrow();
});

test("accepts customers for the requested region only", () => {
  const value = { version: FUNDING_PROVIDER_CUSTOMERS_VERSION, customers: [pending] };
  expect(() => assertFundingProviderCustomersResponse(value, "AR")).not.toThrow();
  expect(() => assertFundingProviderCustomersResponse(value, "BR")).toThrow("Invalid funding provider customers response");
});


test("retains valid customer states without accepting another region", () => {
  for (const state of ["reserving", "pending", "verified", "rejected", "dispatch-ambiguous"] as const) {
    const customer = { ...pending, state };
    expect(readFundingProviderCustomers({ customers: [customer] })).toEqual([customer]);
    expect(readFundingProviderCustomer({ customer })).toEqual(customer);
    expect(isFundingCustomerListFor([customer], "AR")).toBe(true);
    expect(isFundingCustomerListFor([customer], "BR")).toBe(false);
  }
});

test("filters malformed cached customers but rejects partial network envelopes", () => {
  for (const override of [
    { providerId: null }, { region: 1 }, { state: "unknown" },
    { verificationStartedAt: undefined }, { updatedAt: null },
  ]) {
    const invalid = { ...pending, ...override };
    expect(readFundingProviderCustomers({ customers: [pending, invalid] })).toEqual([pending]);
    expect(readFundingProviderCustomer({ customer: invalid })).toBeNull();
    expect(isFundingCustomerListFor([pending, invalid], "AR")).toBe(false);
    expect(() => assertFundingProviderCustomersResponse({ version: 1, customers: [pending, invalid] }, "AR"))
      .toThrow("Invalid funding provider customers response");
  }
});

test("handoff parsing preserves string-only, maximum-length behavior without URL normalization", () => {
  for (const url of ["", "not-a-url", "x".repeat(4096)]) {
    expect(readVerificationHandoff({ version: 1, handoff: { url } })).toBe(url);
  }
  for (const value of [null, [], {}, { version: 1, handoff: null }, { version: 1, handoff: [] }, { version: 1, handoff: { url: 1 } }, { version: 1, handoff: { url: ["https://example.com"] } }, { version: 1, handoff: { url: "x".repeat(4097) } }]) {
    expect(readVerificationHandoff(value)).toBeNull();
  }
});


test("rejects missing or skewed verification response versions", () => {
  for (const version of [undefined, 2, "1"]) {
    expect(readVerificationHandoff({ version, handoff: { url: "https://kyc.example.com/start" } })).toBeNull();
  }
});
