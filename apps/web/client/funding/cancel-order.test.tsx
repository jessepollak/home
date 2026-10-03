import "@/client/account/dom-test-harness";

import { afterEach, expect, test } from "bun:test";
import type { ComponentProps } from "react";
import { getHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import { MoneyModal } from "@/client/money-modal";
import { FundingOrderFlow } from "./order-flow";
import { shouldPollFundingOrder } from "./order-polling";
import type { FundingOrderSummary } from "@/shared/funding/contracts/order";
import type { FundingBinding } from "@/shared/funding/contracts/providers";

const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const binding: FundingBinding = {
  direction: "onramp", providerId: "coinbase", displayName: "Coinbase", region: "US", currency: "USD",
  assetId: "base:usdc", assetSymbol: "USDC", assetDecimals: 6, quotes: true, customerSetup: null,
  paymentMethods: [{ id: "apple-pay", label: "Apple Pay" }],
};
const pending: FundingOrderSummary = {
  id: "cancel-test", providerId: "coinbase", state: "awaiting-payment", fiatAmount: "25", providerStatus: null,
  expectedTokenAmountAtomic: "25000000", instructions: { kind: "redirect", url: "https://pay.coinbase.com/checkout" },
};
const cancelled: FundingOrderSummary = { ...pending, state: "abandoned", abandonReason: "owner", instructions: null };
type Fetch = ComponentProps<typeof FundingOrderFlow>["fetchAccountResource"];
function flow(fetch: Fetch, order = pending, owner = "owner-a", onBack = () => {}) {
  return <MoneyModal open labelledBy="cancel-title" onCancel={() => {}} onClose={() => {}}>
    <FundingOrderFlow binding={binding} fetchAccountResource={fetch} queryOwnerKey={owner} initialOrder={order}
      titleId="cancel-title" onBack={onBack} onOpenRedirect={() => {}} />
  </MoneyModal>;
}
afterEach(() => { cleanup(); getHomeQueryClient().clear(); });

test("cancel success shows Home-local cancellation and starts a new deposit", async () => {
  const requests: unknown[] = [];
  let backs = 0;
  const view = render(flow(async (path, options) => {
    requests.push([path, options?.method, options?.body]);
    return { version: 1, order: cancelled };
  }, pending, "owner-a", () => { backs += 1; }));
  fireEvent.click(view.getByRole("button", { name: "Cancel deposit" }));
  await view.findByRole("heading", { name: "Deposit cancelled" });
  expect(requests).toEqual([["/api/funding/orders/cancel-test/cancel", "POST", { version: 1 }]]);
  expect(view.getByText(/Don't complete it in Coinbase/)).toBeTruthy();
  expect(getHomeQueryClient().getQueryData<FundingOrderSummary>(ownerQueryKey("owner-a", "funding-order", pending.id))).toEqual(cancelled);
  fireEvent.click(view.getByRole("button", { name: "Start new deposit" }));
  expect(backs).toBe(1);
  expect(shouldPollFundingOrder(cancelled)).toBe(false);
});

test("a late order read after cancellation cannot restore the checkout", async () => {
  let release: ((value: unknown) => void) | null = null;
  const deferred = new Promise<unknown>((resolve) => { release = resolve; });
  const view = render(flow(async (path) => {
    if (path.endsWith("/cancel")) return { version: 1, order: cancelled };
    if (path === "/api/funding/orders/cancel-test") return deferred;
    throw new Error(`unexpected path ${path}`);
  }));
  const client = getHomeQueryClient();
  const key = ownerQueryKey("owner-a", "funding-order", pending.id);
  await act(async () => { void client.refetchQueries({ queryKey: key, type: "active" }); });
  fireEvent.click(view.getByRole("button", { name: "Cancel deposit" }));
  await view.findByRole("heading", { name: "Deposit cancelled" });
  await act(async () => { release?.({ version: 1, order: pending }); await Promise.resolve(); });
  expect(view.getByRole("heading", { name: "Deposit cancelled" })).toBeTruthy();
  expect(view.queryByRole("link", { name: "Continue to payment" })).toBeNull();
  expect(client.getQueryData<FundingOrderSummary>(key)).toEqual(cancelled);
});

test("a paid deposit keeps its status copy without offering payment instructions", async () => {
  const view = render(flow(async () => { throw new Error("no request expected"); },
    { ...pending, state: "settling", providerStatus: "PROCESSING" }));
  expect(view.getByRole("heading", { name: "Payment received" })).toBeTruthy();
  expect(view.getByText(/Coinbase is processing your payment/)).toBeTruthy();
  expect(view.queryByRole("link", { name: "Continue to payment" })).toBeNull();
});

test("cancellation invalidates only the owner's region/provider and Activity scopes", async () => {
  const client = getHomeQueryClient();
  const keys = [ownerQueryKey("owner-a", "funding-open-order", "US"),
    ownerQueryKey("owner-a", "funding-open-order-by-provider", "US", "coinbase", "apple-pay"),
    ownerQueryKey("owner-a", "activity-orders")];
  const foreign = ownerQueryKey("owner-b", "funding-open-order", "US");
  for (const key of [...keys, foreign]) client.setQueryData(key, null);
  const view = render(flow(async () => ({ version: 1, order: cancelled })));
  fireEvent.click(view.getByRole("button", { name: "Cancel deposit" }));
  await view.findByText("Deposit cancelled");
  for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  expect(client.getQueryState(foreign)?.isInvalidated).toBe(false);
});

test("a mismatched cancellation response fails without writing or invalidating", async () => {
  const client = getHomeQueryClient();
  const key = ownerQueryKey("owner-a", "activity-orders");
  client.setQueryData(key, []);
  const view = render(flow(async () => ({ version: 1, order: { ...cancelled, id: "other-order" } })));
  fireEvent.click(view.getByRole("button", { name: "Cancel deposit" }));
  expect((await view.findByRole("alert")).textContent).toContain("Couldn't cancel this deposit. Try again.");
  expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  expect(view.queryByText("Deposit cancelled")).toBeNull();
});

test("503 preserves Cancel and Continue and displays the server message", async () => {
  const view = render(flow(async () => { throw Object.assign(new Error("status"), {
    code: "ORDER_STATUS_UNAVAILABLE", serverMessage: "Home couldn't check this deposit with the provider. Try again.", status: 503,
  }); }));
  fireEvent.click(view.getByRole("button", { name: "Cancel deposit" }));
  expect((await view.findByRole("alert")).textContent).toContain("Home couldn't check this deposit");
  expect(view.getByRole("link", { name: "Continue to payment" })).toBeTruthy();
  expect(view.getByRole("button", { name: "Cancel deposit" }).hasAttribute("disabled")).toBe(false);
});

for (const code of ["ORDER_STATE_CHANGED", "ORDER_NOT_CANCELLABLE"]) {
  test(`${code} refetches and shows payment received instead of payment instructions`, async () => {
    const reads: string[] = [];
    const view = render(flow(async (path) => {
      reads.push(path);
      if (path.endsWith("/cancel")) throw Object.assign(new Error("race"), { code, status: 409 });
      return { order: { ...pending, state: "settling", instructions: null } };
    }));
    fireEvent.click(view.getByRole("button", { name: "Cancel deposit" }));
    await view.findByRole("heading", { name: "Payment received" });
    expect(reads).toEqual(["/api/funding/orders/cancel-test/cancel", "/api/funding/orders/cancel-test"]);
    expect(view.getByText("Coinbase is processing your payment. Home will show the money when it arrives on Base.")).toBeTruthy();
    expect(view.queryByText(/Complete the payment instructions/)).toBeNull();
  });
}

test("double click sends one cancellation request and loads the pressed button", async () => {
  let finish: (value: unknown) => void = () => { throw new Error("Cancellation resolver is not initialized"); };
  const result = new Promise<unknown>((resolve) => { finish = resolve; });
  let calls = 0;
  const view = render(flow(async () => { calls += 1; return result; }));
  const cancel = view.getByRole("button", { name: "Cancel deposit" });
  fireEvent.click(cancel); fireEvent.click(cancel);
  await waitFor(() => expect(calls).toBe(1));
  expect(cancel.getAttribute("aria-busy")).toBe("true");
  expect(cancel.getAttribute("aria-disabled")).toBe("true");
  await act(async () => { finish({ version: 1, order: cancelled }); await result; });
  await view.findByText("Deposit cancelled");
});

test("X never posts a cancellation", async () => {
  const writes: string[] = [];
  const view = render(flow(async (path) => { writes.push(path); return { order: pending }; }));
  fireEvent.click(view.getByRole("button", { name: "Close add money" }));
  await act(async () => { await Promise.resolve(); });
  expect(writes).toEqual([]);
});

test("an owner change fences an in-flight cancellation result", async () => {
  let finish: (value: unknown) => void = () => { throw new Error("Cancellation resolver is not initialized"); };
  const result = new Promise<unknown>((resolve) => { finish = resolve; });
  const fetch: Fetch = async () => result;
  const view = render(flow(fetch));
  fireEvent.click(view.getByRole("button", { name: "Cancel deposit" }));
  await act(async () => { await Promise.resolve(); });
  view.rerender(flow(async () => ({ order: pending }), pending, "owner-b"));
  await act(async () => { finish({ version: 1, order: cancelled }); await result; });
  expect(view.queryByText("Deposit cancelled")).toBeNull();
  expect(getHomeQueryClient().getQueryData<FundingOrderSummary>(ownerQueryKey("owner-b", "funding-order", pending.id))?.state).toBe("awaiting-payment");
});

for (const [state, reason, title, body] of [
  ["abandoned", "timed-out", "Checkout timed out", "This checkout wasn't paid in time."],
  ["unknown", null, "Checking deposit status", "Don't pay again."],
  ["payment-received", null, "Payment received", "Coinbase is processing your payment."],
] as const) {
  test(`${state}/${reason} has safe copy`, async () => {
    const order = { ...pending, state, abandonReason: reason, instructions: null };
    const view = render(flow(async () => ({ order }), order));
    await view.findByRole("heading", { name: title });
    expect(view.getByText(new RegExp(body.replace(/[.]/g, "\\.")))).toBeTruthy();
    expect(view.queryByText(/Complete the payment instructions/)).toBeNull();
  });
}

test("economics review keeps Continue and Cancel with secondary loading", async () => {
  const order: FundingOrderSummary = { ...pending, instructions: { kind: "bank-transfer", rail: "ACH", accountNumber: "123", amount: "25", currency: "USD" } };
  const view = render(flow(async () => ({ version: 1, order: cancelled }), order));
  expect(view.getByRole("button", { name: "View payment instructions" })).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Cancel deposit" }));
  await view.findByText("Deposit cancelled");
});

test("iframe load_error only trusts the checkout origin and source and still refetches", async () => {
  const order: FundingOrderSummary = { ...pending, expectedTokenAmountAtomic: undefined,
    instructions: { kind: "embed", presentation: "apple-pay", url: "https://pay.coinbase.com/embedded/apple-pay", amount: "25", currency: "USD" } };
  let reads = 0;
  const view = render(flow(async () => { reads += 1; return { order }; }, order));
  const iframe = view.getByTitle("Apple Pay");
  if (!(iframe instanceof HTMLIFrameElement)) throw new Error("Expected an Apple Pay iframe");
  const send = (origin: string, source: MessageEventSource | null) => window.dispatchEvent(new MessageEvent("message", {
    origin, source, data: { eventName: "onramp_api.load_error" },
  }));
  const notice = "Coinbase couldn't load this checkout. It may have expired. Cancel it and start a new deposit.";
  act(() => { send("https://evil.example", iframe.contentWindow); send("https://pay.coinbase.com", window); });
  expect(view.queryByText(notice)).toBeNull(); expect(reads).toBe(0);
  act(() => { send("https://pay.coinbase.com", iframe.contentWindow); });
  await view.findByText(notice);
  await waitFor(() => expect(reads).toBe(1));
  expect(within(view.getByRole("dialog")).getByRole("button", { name: "Cancel deposit" })).toBeTruthy();
});
