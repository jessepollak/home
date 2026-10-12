import { describe, expect, test } from "bun:test";
import { createHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import { FUNDING_OPEN_ORDER_VERSION } from "@/shared/funding/contracts/open-order";
import { FUNDING_PROVIDER_CUSTOMERS_VERSION } from "@/shared/funding/contracts/provider-customers";
import { FUNDING_PROVIDERS_VERSION } from "@/shared/funding/contracts/providers";
import { deferred } from "@/tests/helpers/async";
import {
  fundingOpenOrderQuery,
  fundingOrderQuery,
  fundingProviderCustomersQuery,
  fundingProvidersQuery,
} from "./funding-queries";

const order = { id: "order-1", providerId: "provider", state: "awaiting-payment", fiatAmount: "25", providerStatus: null, instructions: null };
const binding = { providerId: "provider", displayName: "Provider", region: "AR", assetId: "base:usdc", assetSymbol: "USDC", assetDecimals: 6, currency: "ARS", direction: "onramp", paymentMethods: [{ id: "bank", label: "Bank" }], quotes: true, customerSetup: null, resumeOnly: false } satisfies import("@/shared/funding/contracts/providers").FundingBinding;
const customer = { providerId: "provider", region: "AR", state: "pending", verificationStartedAt: null, updatedAt: "2026-01-01" } satisfies import("@/shared/funding/contracts/provider-customers").FundingProviderCustomerSummary;
const offrampBinding = { providerId: "provider", displayName: "Provider", region: "AR", assetId: "base:usdc", assetSymbol: "USDC", assetDecimals: 6, currency: "ARS", direction: "offramp", paymentMethods: [{ id: "bank", label: "Bank", platform: "bank", handleHint: "CBU", minimumAmountAtomic: "1", maximumAmountAtomic: null, estimateSemantics: "approximate", etaSemantics: "historical-not-guaranteed", corridorConfirmedBy: "provider" }], quotes: false, customerSetup: null } satisfies import("@/shared/funding/contracts/providers").FundingOfframpBinding;
const providersOk = (direction: "onramp" | "offramp", providers: unknown[]) => ({ version: FUNDING_PROVIDERS_VERSION, direction, providers });
const customersOk = (customers: unknown[]) => ({ version: FUNDING_PROVIDER_CUSTOMERS_VERSION, customers });
const openOrderOk = (value: unknown) => ({ version: FUNDING_OPEN_ORDER_VERSION, order: value });

describe("funding query factories", () => {
  test("passes an AbortSignal and caches parsed values for all routes", async () => {
    const paths: string[] = [];
    const fetchResource = async (path: string, options?: { signal?: AbortSignal }) => {
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      paths.push(path);
      if (path.startsWith("/api/funding/providers?")) return providersOk("onramp", [binding]);
      if (path.startsWith("/api/funding/provider-customers?")) return customersOk([customer]);
      return openOrderOk(order);
    };
    const client = createHomeQueryClient();
    expect(await client.fetchQuery(fundingProvidersQuery("owner-a", "AR", "onramp", fetchResource))).toEqual([binding]);
    expect(await client.fetchQuery(fundingOpenOrderQuery("owner-a", "AR", fetchResource))).toEqual(order);
    expect(await client.fetchQuery(fundingProviderCustomersQuery("owner-a", "AR", fetchResource))).toEqual([customer]);
    expect(await client.fetchQuery({ ...fundingOrderQuery("owner-a", order, fetchResource), initialDataUpdatedAt: () => 0 })).toEqual(order);
    expect(paths).toEqual([
      "/api/funding/providers?region=AR&direction=onramp",
      "/api/funding/orders?region=AR",
      "/api/funding/provider-customers?region=AR",
      "/api/funding/orders/order-1",
    ]);
  });

  test("provider direction partitions the key and rejects rows bound to another direction", async () => {
    const client = createHomeQueryClient();
    const query = fundingProvidersQuery("owner-a", "AR", "offramp", async (path) => {
      expect(path).toBe("/api/funding/providers?region=AR&direction=offramp");
      return providersOk("offramp", [offrampBinding]);
    });
    expect([...query.queryKey]).toEqual([...ownerQueryKey("owner-a", "funding-providers", "AR", "offramp")]);
    expect(await client.fetchQuery(query)).toEqual([offrampBinding]);
    const mismatched = fundingProvidersQuery("owner-a", "AR", "offramp", async () => providersOk("onramp", [binding]));
    await expect(createHomeQueryClient().fetchQuery(mismatched)).rejects.toThrow("Invalid funding providers response");
  });

  test("rejects a provider read without the envelope version and caches nothing", async () => {
    const client = createHomeQueryClient();
    await expect(client.fetchQuery(fundingProvidersQuery("owner-a", "AR", "offramp", async () => ({ providers: [offrampBinding] }))))
      .rejects.toThrow("Invalid funding providers response");
    await expect(createHomeQueryClient().fetchQuery(fundingProvidersQuery("owner-b", "AR", "offramp", async () => ({ providers: "x" }))))
      .rejects.toThrow("Invalid funding providers response");
    expect(client.getQueryData<readonly unknown[]>(ownerQueryKey("owner-a", "funding-providers", "AR", "offramp"))).toBeUndefined();
  });

  test("rejects malformed envelopes without caching data, but preserves empty results", async () => {
    for (const invalid of [{}, { providers: "x" }, providersOk("onramp", [{ providerId: "partial" }])]) {
      const client = createHomeQueryClient();
      const query = fundingProvidersQuery("owner-a", "AR", "onramp", async () => invalid);
      await expect(client.fetchQuery(query)).rejects.toThrow("Invalid funding providers response");
      expect(client.getQueryData(query.queryKey)).toBeUndefined();
    }
    for (const invalid of [{}, openOrderOk({}), openOrderOk({ id: 1 })]) {
      const client = createHomeQueryClient();
      const query = fundingOpenOrderQuery("owner-a", "AR", async () => invalid);
      await expect(client.fetchQuery(query)).rejects.toThrow("Invalid funding open order response");
      expect(client.getQueryData(query.queryKey)).toBeUndefined();
      const byId = fundingOrderQuery("owner-a", order, async () => invalid);
      await expect(client.fetchQuery({ ...byId, initialData: undefined })).rejects.toThrow("Funding order response is invalid.");
      expect(client.getQueryData(byId.queryKey)).toBeUndefined();
    }
    for (const invalid of [{}, { customers: "x" }, customersOk([{ providerId: "partial" }])]) {
      const client = createHomeQueryClient();
      const query = fundingProviderCustomersQuery("owner-a", "AR", async () => invalid);
      await expect(client.fetchQuery(query)).rejects.toThrow("Invalid funding provider customers response");
      expect(client.getQueryData(query.queryKey)).toBeUndefined();
    }
    const client = createHomeQueryClient();
    expect(await client.fetchQuery(fundingProvidersQuery("owner-a", "AR", "onramp", async () => providersOk("onramp", [])))).toEqual([]);
    expect(await client.fetchQuery(fundingOpenOrderQuery("owner-a", "AR", async () => openOrderOk(null)))).toBeNull();
    expect(await client.fetchQuery(fundingProviderCustomersQuery("owner-a", "AR", async () => customersOk([])))).toEqual([]);
    const missing = fundingOrderQuery("owner-a", order, async () => openOrderOk(null));
    await expect(client.fetchQuery({ ...missing, initialData: undefined })).rejects.toThrow("Funding order response is invalid.");
    expect(client.getQueryData(missing.queryKey)).toBeUndefined();
    await expect(client.fetchQuery(fundingProvidersQuery("owner-a", "ID", "onramp", undefined))).rejects.toThrow("Funding providers are unavailable.");
  });

  test("late owner-a resolution cannot populate owner-b's key", async () => {
    const { promise: delayed, resolve } = deferred<unknown>();
    const client = createHomeQueryClient();
    const first = fundingProvidersQuery("owner-a", "AR", "onramp", async () => delayed);
    const second = fundingProvidersQuery("owner-b", "AR", "onramp", async () => providersOk("onramp", []));
    const pending = client.fetchQuery(first);
    expect(first.queryKey).not.toEqual(second.queryKey);
    expect(await client.fetchQuery(second)).toEqual([]);
    resolve(providersOk("onramp", [binding]));
    expect(await pending).toEqual([binding]);
    expect(client.getQueryData<readonly unknown[]>(first.queryKey)).toEqual([binding]);
    expect(client.getQueryData<readonly unknown[]>(second.queryKey)).toEqual([]);
  });
});
