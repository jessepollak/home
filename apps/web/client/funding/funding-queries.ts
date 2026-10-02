import type { QueryKey } from "@tanstack/react-query";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import type { RegionId } from "@/config/regions";
import { disabledQueryKey, ownerQueryKey, publicQueryKey } from "@/client/query/query-client";
import { ownerQuery, publicQuery } from "@/client/query/query-options";
import { assertFundingOpenOrderResponse, fundingOpenOrderPath } from "@/shared/funding/contracts/open-order";
import { readFundingOrder, type FundingOrderSummary } from "@/shared/funding/contracts/order";
import { assertFundingProviderCustomersResponse, readFundingProviderCustomers, type FundingProviderCustomerSummary } from "@/shared/funding/contracts/provider-customers";
import { assertFundingProvidersResponse, readProviderBindings, type FundingBinding } from "@/shared/funding/contracts/providers";
import { shouldPollFundingOrder } from "./order-polling";

type FetchResource = AccountWalletClient["fetchAccountResource"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOrder(value: unknown): FundingOrderSummary | null {
  if (!isRecord(value) || !("order" in value)) throw new Error("Funding order response is invalid.");
  if (value.order === null) return null;
  const order = readFundingOrder(value);
  if (!order) throw new Error("Funding order response is invalid.");
  return order;
}

export function fundingProvidersQuery(owner: string | null, region: RegionId, direction: "onramp" | "offramp", fetchResource: FetchResource | undefined) {
  return ownerQuery<readonly FundingBinding[]>({
    owner, scope: "funding-providers", key: [region, direction], retry: false, refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      if (!fetchResource) throw new Error("Funding providers are unavailable.");
      const value: unknown = await fetchResource(`/api/funding/providers?region=${encodeURIComponent(region)}&direction=${direction}`, { signal });
      assertFundingProvidersResponse(value, direction, region);
      return readProviderBindings(value);
    },
  });
}

export function fundingOpenOrderQuery(owner: string | null, region: RegionId, fetchResource: FetchResource) {
  return ownerQuery<FundingOrderSummary | null>({
    owner, scope: "funding-open-order", key: [region], retry: false, refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const value: unknown = await fetchResource(fundingOpenOrderPath({ region }), { signal });
      assertFundingOpenOrderResponse(value, region);
      return readFundingOrder(value);
    },
  });
}

export function fundingProviderCustomersQuery(owner: string | null, region: RegionId, fetchResource: FetchResource) {
  return ownerQuery<readonly FundingProviderCustomerSummary[]>({
    owner, scope: "funding-provider-customers", key: [region], retry: false, refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const value: unknown = await fetchResource(`/api/funding/provider-customers?region=${encodeURIComponent(region)}`, { signal });
      assertFundingProviderCustomersResponse(value, region);
      return readFundingProviderCustomers(value);
    },
  });
}

export function fundingOrderKey(owner: string | null, order: FundingOrderSummary | null): QueryKey {
  if (!order) return disabledQueryKey("funding-order");
  return owner ? ownerQueryKey(owner, "funding-order", order.id) : publicQueryKey("funding-order-isolated", order.id);
}

export function fundingOrderQuery(owner: string | null, order: FundingOrderSummary | null, fetchResource: FetchResource) {
  const queryFn = async ({ signal }: { signal: AbortSignal }) => {
    if (!order) throw new Error("Funding order is unavailable.");
    const next = parseOrder(await fetchResource(`/api/funding/orders/${order.id}`, { signal }));
    if (!next) throw new Error("Funding order response is invalid.");
    return next;
  };
  if (!order) return ownerQuery({ owner: null, scope: "funding-order", queryFn });
  const options = {
    key: [order.id], enabled: shouldPollFundingOrder(order), initialData: order,
    initialDataUpdatedAt: () => Date.now(), retry: false, refetchOnWindowFocus: false,
    queryFn,
  };
  return owner
    ? ownerQuery({ ...options, owner, scope: "funding-order", refetchInterval: (query) => shouldPollFundingOrder(query.state.data) ? 4_000 : false })
    : publicQuery({ ...options, scope: "funding-order-isolated", refetchInterval: (query) => shouldPollFundingOrder(query.state.data) ? 4_000 : false });
}
