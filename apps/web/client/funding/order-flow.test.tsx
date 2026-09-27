import "@/client/account/dom-test-harness";

import { afterEach, expect, test } from "bun:test";
import type { ComponentProps } from "react";
import { page } from "@/tests/helpers/dom";
import { getHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import type { FundingBinding } from "@/shared/funding/contracts/providers";
import { MoneyModal } from "@/client/money-modal";

const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { FundingOrderFlow, readFundingOrder } = await import("./order-flow");

const binding: FundingBinding = {
  direction: "onramp", providerId: "ripio", displayName: "Ripio", region: "CO", assetId: "base:wcop", assetSymbol: "wCOP", assetDecimals: 18,
  currency: "COP", paymentMethods: [{ id: "bank_transfer", label: "Bank transfer" }, { id: "breb", label: "Bre-B" }],
  quotes: true, customerSetup: null,
};
const ownerKey = "owner-a";
const activityKey = ownerQueryKey(ownerKey, "activity-orders");
const order = readFundingOrder({ order: {
  id: "11111111-1111-4111-8111-111111111111", providerId: "ripio", state: "awaiting-payment", fiatAmount: "100", providerStatus: null, instructions: null,
} })!;

function renderFlow(fetchAccountResource: ComponentProps<typeof FundingOrderFlow>["fetchAccountResource"], initialOrder?: typeof order) {
  return render(
    <MoneyModal open labelledBy="deposit-title" onCancel={() => {}} onClose={() => {}}>
      <FundingOrderFlow
        binding={binding}
        fetchAccountResource={fetchAccountResource}
        queryOwnerKey={ownerKey}
        titleId="deposit-title"
        onBack={() => {}}
        onOpenRedirect={() => {}}
        initialOrder={initialOrder}
      />
    </MoneyModal>,
  );
}

afterEach(() => {
  cleanup();
  getHomeQueryClient().clear();
});

test("selecting a payment method does not request a quote until Review quote", async () => {
  const requests: Array<{ path: string; body: unknown }> = [];
  render(
    <MoneyModal open labelledBy="deposit-title" onCancel={() => {}} onClose={() => {}}>
      <FundingOrderFlow
      binding={binding}
      fetchAccountResource={async (path, options) => {
        requests.push({ path, body: options?.body });
        if (path === "/api/funding/quotes") return {
          quoteToken: "signed-token",
          quote: { fiatAmount: "100", tokenAmountAtomic: "100000000000000000000", fees: [], expiresAt: "2099-01-01T00:00:00.000Z" },
        };
        throw new Error(`Unexpected request: ${path}`);
      }}
      titleId="deposit-title"
      onBack={() => {}}
      onOpenRedirect={() => {}}
      />
    </MoneyModal>,
  );
  const group = page().getByRole("radiogroup", { name: "Payment method" });
  expect(group).toBeTruthy();
  expect(page().getByRole("radio", { name: "Bank transfer" }).getAttribute("aria-checked")).toBe("true");
  fireEvent.click(page().getByText("Bre-B"));
  expect(page().getByRole("radio", { name: "Bre-B" }).getAttribute("aria-checked")).toBe("true");
  expect(requests).toEqual([]);
  fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "100" } });
  expect(requests).toEqual([]);
  fireEvent.click(page().getByRole("button", { name: "Review quote" }));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toMatchObject({ path: "/api/funding/quotes", body: { paymentMethod: "breb", fiatAmount: "100" } });
  await page().findByRole("heading", { name: "Review quote" });
  expect(page().queryByRole("radiogroup", { name: "Payment method" })).toBeNull();
});

test("confirming a funding order invalidates the owner's activity orders", async () => {
  const client = getHomeQueryClient();
  client.setQueryData(activityKey, { orders: [] });
  renderFlow(async (path) => {
    if (path === "/api/funding/quotes") return {
      quoteToken: "signed-token",
      quote: { fiatAmount: "100", tokenAmountAtomic: "100000000000000000000", fees: [], expiresAt: "2099-01-01T00:00:00.000Z" },
    };
    if (path === "/api/funding/orders") return { order };
    if (path === `/api/funding/orders/${order.id}`) return { order };
    throw new Error(`Unexpected request: ${path}`);
  });
  fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "100" } });
  fireEvent.click(page().getByRole("button", { name: "Review quote" }));
  await page().findByRole("heading", { name: "Review quote" });
  expect(client.getQueryState(activityKey)?.isInvalidated).toBe(false);
  fireEvent.click(page().getByRole("button", { name: "Confirm deposit" }));
  await waitFor(() => expect(client.getQueryState(activityKey)?.isInvalidated).toBe(true));
});

test("a changed funding order state invalidates activity orders", async () => {
  const client = getHomeQueryClient();
  client.setQueryData(activityKey, { orders: [] });
  renderFlow(async (path) => {
    if (path === `/api/funding/orders/${order.id}`) return { order: { ...order, state: "settling" } };
    throw new Error(`Unexpected request: ${path}`);
  }, order);
  expect(client.getQueryState(activityKey)?.isInvalidated).toBe(false);
  await client.refetchQueries({ queryKey: ownerQueryKey(ownerKey, "funding-order", order.id) });
  await waitFor(() => expect(client.getQueryState(activityKey)?.isInvalidated).toBe(true));
});

test("resolving an ambiguous funding order invalidates activity orders", async () => {
  const client = getHomeQueryClient();
  const ambiguous = { ...order, state: "dispatch-ambiguous" };
  client.setQueryData(activityKey, { orders: [] });
  renderFlow(async (path) => {
    if (path === `/api/funding/orders/${order.id}/resolve`) return { version: 1, order: { ...order, state: "cancelled" } };
    if (path === `/api/funding/orders/${order.id}`) return { order: ambiguous };
    throw new Error(`Unexpected request: ${path}`);
  }, ambiguous);
  expect(client.getQueryState(activityKey)?.isInvalidated).toBe(false);
  fireEvent.click(page().getByRole("button", { name: "Clear old order" }));
  await page().findByText("Order cleared");
  await waitFor(() => expect(client.getQueryState(activityKey)?.isInvalidated).toBe(true));
});
