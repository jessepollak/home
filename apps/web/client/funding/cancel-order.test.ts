import { expect, test } from "bun:test";
import { createHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import type { ActivityFundingOrder, ActivityOrder } from "@/shared/activity/contract-orders";
import type { FundingOrderSummary } from "@/shared/funding/contracts/order";
import { applyCancelledFundingOrder } from "./cancel-order";

const awaitingPayment: ActivityFundingOrder = {
  kind: "funding", id: "order-1", region: "AR", providerId: "provider", providerName: "Provider",
  paymentMethodLabel: "Bank", status: "waiting-customer", stage: "awaiting-payment",
  instruction: "bank-transfer", resumable: true, fiatAmount: "25", fiatCurrency: "ARS",
  asset: { id: "base:usdc", symbol: "USDC", decimals: 6 }, tokenAmountAtomic: "25000000",
  sandbox: false, expiresAt: "2026-01-01T01:00:00.000Z", clearableAt: null,
  transactionHash: null, logIndex: null,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  movedAt: "2026-01-01T00:00:00.000Z",
};
const cancelled: FundingOrderSummary = {
  id: "order-1", providerId: "provider", state: "abandoned", fiatAmount: "25",
  providerStatus: null, instructions: null, abandonReason: "owner", updatedAt: "2026-01-01T00:05:00.000Z",
};

test("a failed activity refetch preserves the cancelled funding row without changing unrelated orders", async () => {
  const client = createHomeQueryClient();
  const queryKey = ownerQueryKey("owner-a", "activity-orders");
  const unrelated = { ...awaitingPayment, id: "order-2" };
  client.setQueryData<ActivityOrder[]>(queryKey, [awaitingPayment, unrelated]);
  const previous = client.getQueryData<ActivityOrder[]>(queryKey);

  await applyCancelledFundingOrder(client, "owner-a", cancelled);
  await expect(client.fetchQuery({
    queryKey, staleTime: 0, retry: false,
    queryFn: async () => { throw new Error("Activity orders unavailable"); },
  })).rejects.toThrow("Activity orders unavailable");

  const cached = client.getQueryData<ActivityOrder[]>(queryKey);
  expect(cached?.[0]).toEqual({
    ...awaitingPayment, status: "failed", stage: "cancelled", abandonReason: "owner",
    instruction: null, resumable: false, clearableAt: null,
    updatedAt: "2026-01-01T00:05:00.000Z", movedAt: "2026-01-01T00:05:00.000Z",
  });
  expect(cached?.[1]).toBe(previous?.[1]);
  expect(cached?.[1]).toEqual(unrelated);
  client.clear();
});
