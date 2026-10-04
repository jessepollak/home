import { describe, expect, test } from "bun:test";
import { QueryObserver, skipToken, type QueryKey, type UseQueryOptions } from "@tanstack/react-query";
import { createHomeQueryClient, disabledQueryKey, ownerQueryKey, publicQueryKey } from "@/client/query/query-client";
import { FUNDING_OPEN_ORDER_VERSION } from "@/shared/funding/contracts/open-order";
import { FUNDING_PROVIDER_CUSTOMERS_VERSION } from "@/shared/funding/contracts/provider-customers";
import { FUNDING_PROVIDERS_VERSION } from "@/shared/funding/contracts/providers";
import { deferred } from "@/tests/helpers/async";
import {
  fundingOpenOrderQuery,
  fundingOrderKey,
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
const neverFetch = async () => { throw new Error("Unexpected fetch"); };

function expectDisabled<T>(options: UseQueryOptions<T, Error, T, QueryKey>) {
  const client = createHomeQueryClient();
  const observer = new QueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => {});
  expect(observer.getCurrentResult().fetchStatus).toBe("idle");
  unsubscribe();
}

describe("funding query factories", () => {
  test("registered owner keys and disabled queries", () => {
    const cases = [
      { scope: "funding-providers", parts: ["AR", "onramp"], factory: (owner: string | null) => fundingProvidersQuery(owner, "AR", "onramp", neverFetch) },
      { scope: "funding-open-order", parts: ["AR"], factory: (owner: string | null) => fundingOpenOrderQuery(owner, "AR", neverFetch) },
      { scope: "funding-provider-customers", parts: ["AR"], factory: (owner: string | null) => fundingProviderCustomersQuery(owner, "AR", neverFetch) },
    ] satisfies ReadonlyArray<{ scope: "funding-providers" | "funding-open-order" | "funding-provider-customers"; parts: readonly string[]; factory: (owner: string | null) => { queryKey: QueryKey; queryFn?: unknown } }>;
    for (const { scope, parts, factory } of cases) {
      expect([...factory("owner-a").queryKey]).toEqual([...ownerQueryKey("owner-a", scope, ...parts)]);
      const disabled = factory(null);
      expect([...disabled.queryKey]).toEqual([...disabledQueryKey(scope, ...parts)]);
      expect(disabled.queryFn).toBe(skipToken);
    }
    expectDisabled(fundingProvidersQuery(null, "AR", "onramp", neverFetch));
    expectDisabled(fundingOpenOrderQuery(null, "AR", neverFetch));
    expectDisabled(fundingProviderCustomersQuery(null, "AR", neverFetch));
  });

  test("the order key matches all factory variants", () => {
    for (const owner of ["owner-a", null]) {
      for (const current of [order, null]) {
        expect(fundingOrderKey(owner, current)).toEqual(fundingOrderQuery(owner, current, neverFetch).queryKey);
      }
    }
    expect(fundingOrderKey("owner-a", order)).toEqual(ownerQueryKey("owner-a", "funding-order", order.id));
    expect(fundingOrderKey(null, order)).toEqual(publicQueryKey("funding-order-isolated", order.id));
    const disabled = fundingOrderQuery(null, null, neverFetch);
    expect([...disabled.queryKey]).toEqual([...disabledQueryKey("funding-order")]);
    expect(disabled.queryFn).toBe(skipToken);
    expectDisabled(disabled);
  });

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


test.each([undefined, 0, 2, "1"])("order-by-id queries reject envelope version %p without replacing the cached order", async (version) => {
  const client = createHomeQueryClient();
  const query = fundingOrderQuery("owner-a", order, async () => ({ version, order: { ...order, state: "sent" } }));
  client.setQueryData(query.queryKey, order, { updatedAt: 0 });
  await expect(client.fetchQuery({ ...query, initialDataUpdatedAt: () => 0 })).rejects.toThrow("Funding order response is invalid.");
  expect(client.getQueryData<typeof order>(query.queryKey)).toEqual(order);
});
