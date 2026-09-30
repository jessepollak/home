import { expect, test } from "bun:test";
import { assertFundingProviderCustomersResponse, FUNDING_PROVIDER_CUSTOMERS_VERSION } from "./provider-customers";

const pending = { providerId: "ripio", region: "AR", state: "pending", verificationStartedAt: null, updatedAt: "now" };

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
