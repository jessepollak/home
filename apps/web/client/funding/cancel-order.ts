"use client";

import type { AccountWalletClient } from "@/client/account/cdp-client";
import { ownerMutation } from "@/client/query/mutation-options";
import { browserHomeQueryClient, useHomeMutation } from "@/client/query/query-client";
import { fundingOrderKeyForId } from "./funding-queries";
import { FUNDING_ORDER_CANCELLATION_VERSION, readCancelFundingOrderResponse } from "@/shared/funding/contracts/order-cancellation";
import { readFundingFailure } from "@/shared/funding/contracts/errors";

type CancellationOrder = { id: string; region: string; providerId: string };

export function useCancelFundingOrder(owner: string | null, fetchResource: AccountWalletClient["fetchAccountResource"]) {
  return useHomeMutation(ownerMutation({
    owner,
    invalidates: (order: CancellationOrder) => [
      { scope: "funding-open-order", key: [order.region], refetchType: "all" },
      { scope: "funding-open-order-by-provider", key: [order.region, order.providerId], refetchType: "all" },
      { scope: "activity-orders" },
    ],
    mutationFn: async (order: CancellationOrder) => {
      const value = await fetchResource(`/api/funding/orders/${encodeURIComponent(order.id)}/cancel`, {
        method: "POST", body: { version: FUNDING_ORDER_CANCELLATION_VERSION },
      });
      const resolved = readCancelFundingOrderResponse(value);
      if (!resolved || resolved.order.id !== order.id) throw new Error("cancellation");
      await browserHomeQueryClient()?.cancelQueries({ queryKey: fundingOrderKeyForId(owner, order.id) });
      return resolved;
    },
  }));
}

export function cancellationNeedsRefetch(error: unknown): boolean {
  const code = readFundingFailure(error)?.code;
  return code === "ORDER_STATE_CHANGED" || code === "ORDER_NOT_CANCELLABLE";
}

export function cancellationErrorCopy(error: unknown): string {
  if (typeof error === "object" && error !== null && "serverMessage" in error &&
    typeof error.serverMessage === "string" && error.serverMessage) return error.serverMessage;
  return "Couldn't cancel this deposit. Try again.";
}
