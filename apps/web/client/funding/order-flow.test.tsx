import "@/client/account/dom-test-harness";

import { afterEach, expect, test } from "bun:test";
import type { ComponentProps } from "react";
import { page } from "@/tests/helpers/dom";
import { getHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import type { FundingBinding } from "@/shared/funding/contracts/providers";
import { FUNDING_QUOTE_VERSION } from "@/shared/funding/contracts/quotes";
import { FUNDING_OPEN_ORDER_VERSION } from "@/shared/funding/contracts/open-order";
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
          version: FUNDING_QUOTE_VERSION,
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

test("a paused corridor shows the server message for quote errors only", async () => {
  renderFlow(async () => { throw Object.assign(new Error("paused"), { code: "CORRIDOR_NOT_OFFERED", serverMessage: "Ripio is no longer offered here." }); });
  fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "100" } });
  fireEvent.click(page().getByRole("button", { name: "Review quote" }));
  await page().findByText("Ripio is no longer offered here.");
});

test("a pre-pause quote shows the server message on order confirmation", async () => {
  renderFlow(async (path) => {
    if (path === "/api/funding/quotes") return {
      version: FUNDING_QUOTE_VERSION,
      quoteToken: "signed-token",
      quote: { fiatAmount: "100", tokenAmountAtomic: "100000000000000000000", fees: [], expiresAt: "2099-01-01T00:00:00.000Z" },
    };
    throw Object.assign(new Error("paused"), { code: "CORRIDOR_NOT_OFFERED", serverMessage: "Ripio is no longer offered here." });
  });
  fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "100" } });
  fireEvent.click(page().getByRole("button", { name: "Review quote" }));
  await page().findByRole("heading", { name: "Review quote" });
  fireEvent.click(page().getByRole("button", { name: "Confirm deposit" }));
  await page().findByText("Ripio is no longer offered here.");
});

test.each([
  ["confirming a funding order invalidates", "confirm", true],
  ["a failed confirm does not invalidate", "confirm", false],
  ["a changed funding order state invalidates", "poll", true],
  ["resolving an ambiguous funding order invalidates", "resolve", true],
  ["a failed resolve does not invalidate", "resolve", false],
] as const)("%s activity orders", async (_name, trigger, succeeds) => {
  const client = getHomeQueryClient();
  const ambiguous = { ...order, state: "dispatch-ambiguous" };
  client.setQueryData(activityKey, { orders: [] });
  renderFlow(async (path) => {
    if (path === "/api/funding/quotes" && trigger === "confirm") return {
      version: FUNDING_QUOTE_VERSION,
      quoteToken: "signed-token",
      quote: { fiatAmount: "100", tokenAmountAtomic: "100000000000000000000", fees: [], expiresAt: "2099-01-01T00:00:00.000Z" },
    };
    if (path === "/api/funding/orders" && trigger === "confirm") {
      if (!succeeds) throw new Error("unavailable");
      return { order };
    }
    if (path === `/api/funding/orders/${order.id}/resolve` && trigger === "resolve") {
      if (!succeeds) throw new Error("unavailable");
      return { version: 1, order: { ...order, state: "cancelled" } };
    }
    if (path === `/api/funding/orders/${order.id}`) return { order: trigger === "poll" ? { ...order, state: "settling" } : trigger === "resolve" ? ambiguous : order };
    throw new Error(`Unexpected request: ${path}`);
  }, trigger === "confirm" ? undefined : trigger === "resolve" ? ambiguous : order);
  if (trigger === "confirm") {
    fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "100" } });
    fireEvent.click(page().getByRole("button", { name: "Review quote" }));
    await page().findByRole("heading", { name: "Review quote" });
  }
  expect(client.getQueryState(activityKey)?.isInvalidated).toBe(false);
  if (trigger === "poll") {
    await client.refetchQueries({ queryKey: ownerQueryKey(ownerKey, "funding-order", order.id) });
  } else {
    fireEvent.click(page().getByRole("button", { name: trigger === "confirm" ? "Confirm deposit" : "Clear old order" }));
  }
  if (!succeeds) await page().findByRole("alert");
  if (trigger === "resolve" && succeeds) await page().findByText("Order cleared");
  if (succeeds) await waitFor(() => expect(client.getQueryState(activityKey)?.isInvalidated).toBe(true));
  else expect(client.getQueryState(activityKey)?.isInvalidated).toBe(false);
  if (trigger === "confirm" && succeeds) {
    expect(client.getQueryData<{ version: number; order: typeof order }>(ownerQueryKey(ownerKey, "funding-open-order", binding.region))).toEqual({ version: FUNDING_OPEN_ORDER_VERSION, order });
  }
});

test("a verification response without a hand-off still shows the returned blocked setup state", async () => {
  const opened: string[] = [];
  render(
    <MoneyModal open labelledBy="deposit-title" onCancel={() => {}} onClose={() => {}}>
      <FundingOrderFlow
        binding={{ ...binding, customerSetup: { hosted: true } }}
        fetchAccountResource={async (path) => {
          if (path === "/api/funding/provider-customers/verification") return {
            customer: { providerId: "ripio", region: "CO", state: "rejected", verificationStartedAt: null, updatedAt: "2026-09-28T00:00:00.000Z" },
          };
          throw new Error(`Unexpected request: ${path}`);
        }}
        queryOwnerKey={ownerKey}
        titleId="deposit-title"
        onBack={() => {}}
        onOpenRedirect={(url) => { opened.push(url); }}
      />
    </MoneyModal>,
  );
  fireEvent.input(page().getByRole("textbox", { name: "Email" }), { target: { value: "customer@example.com" } });
  fireEvent.click(page().getByRole("button", { name: "Continue to Ripio verification" }));
  await page().findByText(/The provider rejected this setup/);
  expect(page().queryByRole("button", { name: "Continue to Ripio verification" })).toBeNull();
  expect(opened).toEqual([]);
});
