import "@/client/account/dom-test-harness";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { AccountWalletContext, type AccountWalletClient } from "@/client/account/cdp-client";
import { HomeShellRoutingProvider, type HomeInboundPanelState } from "@/client/home/panel-routing";
import { ConnectedActivityPanel } from "@/client/home/activity-panel";
import { activityOwnerKey } from "@/client/activity/use-activity";
import { getHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import { cashoutFixtureAction, cashoutFixtureWithdraw } from "@/tests/browser/feature-map/cashout-fixture";
import { activityOrdersFixture, fundingOrderResolutionFixture, fundingOrderCancellationFixture } from "@/tests/browser/feature-map/fixtures";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import type { ReactNode } from "react";

const { cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
beforeEach(() => { (globalThis as { BASE_UI_ANIMATIONS_DISABLED?: boolean }).BASE_UI_ANIMATIONS_DISABLED = true; });
afterEach(() => { cleanup(); getHomeQueryClient().clear(); delete (globalThis as { BASE_UI_ANIMATIONS_DISABLED?: boolean }).BASE_UI_ANIMATIONS_DISABLED; });
const session = { user: { subject: cashoutFixtureAction.owner.subject }, smartAccount: {
  address: cashoutFixtureAction.owner.address as `0x${string}`, chainId: 8453 as const,
}, accountProvider: "cdp-embedded" as const };

function ActivityProviders({ wallet, routing, children }: { wallet: AccountWalletClient; routing: Parameters<typeof HomeShellRoutingProvider>[0]["value"]; children: ReactNode }) {
  return <AccountWalletContext.Provider value={wallet}><HomeShellRoutingProvider value={routing}>{children}</HomeShellRoutingProvider></AccountWalletContext.Provider>;
}

function setup(options: { failOrders?: boolean; failResolve?: boolean; resolveBody?: unknown; fallback?: boolean | "waiting"; completePayment?: boolean; density?: "page" | "feed" } = {}) {
  const requests: Array<{ path: string; method: string; body?: unknown }> = [];
  const prepared: Array<{ kind: string; params: unknown }> = [];
  const flows: Array<{ flow: string; options: unknown }> = [];
  let cancelled = false;
  const wallet = {
    fetchAccountResource: async (path: string, config?: { method?: string; body?: unknown }) => {
      requests.push({ path, method: config?.method ?? "GET", ...(config?.body ? { body: config.body } : {}) });
      if (path === "/api/activity/orders") {
        if (options.failOrders) throw new Error("Orders unavailable");
        const response = activityOrdersFixture();
        if (cancelled) response.orders = response.orders.map((order) => order.id === "fixture-funding-pending" && order.kind === "funding"
          ? { ...order, stage: "cancelled", abandonReason: "owner", status: "failed", resumable: false, instruction: null } : order);
        if (options.completePayment) {
          response.orders = response.orders.map((order) => order.id === "fixture-funding-pending" && order.kind === "funding"
            ? { ...order, instruction: "bank-transfer" } : order);
        }
        if (options.fallback) {
          const cashout = response.orders.find((order) => order.kind === "cash-out");
          if (cashout?.kind !== "cash-out") throw new Error("Missing cash-out fixture");
          response.orders = [options.fallback === "waiting"
            ? { ...cashout, id: "cashout-fallback", status: "waiting-provider", state: "awaiting-buyer", amountAtomic: "25000000", remainingAtomic: "25000000" }
            : { ...cashout, id: "cashout-fallback", status: "reversed", amountAtomic: "25000000", remainingAtomic: "25000000" }];
        }
        return response;
      }
      if (path === "/api/funding/orders/fixture-funding-pending/cancel") {
        cancelled = true; return fundingOrderCancellationFixture("fixture-funding-pending");
      }
      if (path === "/api/funding/orders/fixture-funding-ambiguous/resolve") {
        if (options.failResolve) throw { serverMessage: "Clear failed. Try again." };
        return options.resolveBody === undefined ? fundingOrderResolutionFixture("fixture-funding-ambiguous") : options.resolveBody;
      }
      throw new Error(`Unexpected resource ${path}`);
    },
    prepareMoneyAction: async (kind: string, params: unknown) => {
      prepared.push({ kind, params });
      return cashoutFixtureWithdraw as PreparedMoneyAction;
    },
  } as AccountWalletClient;
  const routing = { state: {} as HomeInboundPanelState, activityReturn: null, popRevision: 0, rootRequest: null,
    openPanel: () => {}, setFlow: (flow: string, flowOptions: unknown) => {
      flows.push({ flow, options: flowOptions }); return true;
    }, clearFlow: () => {}, canOpenAssetDetail: () => false, openAssetDetail: () => false,
    pushRoute: () => {}, leaveRoute: () => {},
  };
  const view = render(<ActivityProviders wallet={wallet} routing={routing}>
    <ConnectedActivityPanel density={options.density ?? "page"} activitySession={session}
      fetchActivity={async () => { throw new Error("Unavailable"); }}
      fetchOperations={async () => ({ actions: [cashoutFixtureAction] })} regionId="US" />
  </ActivityProviders>);
  return { view, requests, prepared, flows };
}

async function openOrder(view: ReturnType<typeof render>, amount: string) {
  const pending = await view.findByRole("list", { name: "Pending" });
  const row = await within(pending).findByRole("button", { name: new RegExp(`Add money.*\\+\\$${amount}`) });
  fireEvent.click(row);
  return view.findByRole("dialog", { name: "Add money" });
}

test("pending Activity offers both actions and Cancel posts once then shows Cancelled", async () => {
  const { view, requests } = setup();
  await openOrder(view, "25");
  await view.findByRole("button", { name: "Continue with Coinbase" });
  const sheet = within(view.getByRole("dialog", { name: "Add money" }));
  expect(sheet.getByRole("button", { name: "Continue with Coinbase" })).toBeTruthy();
  const cancel = sheet.getByRole("button", { name: "Cancel deposit" });
  fireEvent.click(cancel); fireEvent.click(cancel);
  await sheet.findByText("Cancelled");
  expect(sheet.getByText("Deposit cancelled")).toBeTruthy();
  expect(requests.filter((request) => request.method === "POST")).toEqual([{
    path: "/api/funding/orders/fixture-funding-pending/cancel", method: "POST", body: { version: 1 },
  }]);
  expect(sheet.queryByRole("button", { name: "Cancel deposit" })).toBeNull();
});

test("Clear order posts only to resolve, with version 1, and refreshes orders and the region's open order", async () => {
  const client = getHomeQueryClient();
  const openOrderKey = ownerQueryKey(activityOwnerKey(session), "funding-open-order", "US");
  const otherRegionKey = ownerQueryKey(activityOwnerKey(session), "funding-open-order", "AR");
  let openOrderReads = 0;
  await client.fetchQuery({
    queryKey: openOrderKey,
    queryFn: async () => {
      openOrderReads += 1;
      return openOrderReads === 1 ? { id: "fixture-funding-ambiguous" } : null;
    },
  });
  client.setQueryData(otherRegionKey, null);
  const { view, requests } = setup();
  await openOrder(view, "30");
  fireEvent.click(await view.findByRole("button", { name: "Clear order" }));
  await waitFor(() => expect(requests.filter((request) => request.method === "POST")).toEqual([
    { path: "/api/funding/orders/fixture-funding-ambiguous/resolve", method: "POST", body: { version: 1 } },
  ]));
  await waitFor(() => expect(requests.filter(({ path }) => path === "/api/activity/orders").length).toBeGreaterThan(1));
  await waitFor(() => expect(client.getQueryData<{ id: string } | null>(openOrderKey)).toBeNull());
  expect(openOrderReads).toBe(2);
  expect(client.getQueryState(otherRegionKey)?.isInvalidated).toBe(false);
  expect(requests.some((request) => request.path === "/api/funding/orders")).toBe(false);
});

for (const [completePayment, label] of [[false, "Continue with Coinbase"], [true, "Complete payment"]] as const) {
  test(`${label} opens Add money without creating a new order`, async () => {
    const { view, requests, flows } = setup({ completePayment });
    await openOrder(view, "25");
    fireEvent.click(await view.findByRole("button", { name: label }));
    expect(flows).toEqual([{ flow: "add-money", options: { mode: "push", opener: null } }]);
    expect(requests.every((request) => request.method === "GET")).toBe(true);
  });
}

test("a failed clear shows the server message without starting another order", async () => {
  const client = getHomeQueryClient();
  const openOrderKey = ownerQueryKey(activityOwnerKey(session), "funding-open-order", "US");
  client.setQueryData(openOrderKey, { id: "fixture-funding-ambiguous" });
  const { view, requests } = setup({ failResolve: true });
  await openOrder(view, "30");
  fireEvent.click(await view.findByRole("button", { name: "Clear order" }));
  await waitFor(() => expect(view.getByText("Clear failed. Try again.")).toBeTruthy());
  expect(requests.filter(({ method }) => method === "POST").map(({ path }) => path))
    .toEqual(["/api/funding/orders/fixture-funding-ambiguous/resolve"]);
  expect(client.getQueryState(openOrderKey)?.isInvalidated).toBe(false);
});

for (const [label, resolveBody] of [
  ["malformed", { version: 1 }],
  ["partial order", { version: 1, order: {
    id: "fixture-funding-ambiguous", providerId: "coinbase", region: "US", state: "cancelled", fiatAmount: "30.00",
  } }],
  ["mismatched order", fundingOrderResolutionFixture("fixture-funding-other")],
] as const) {
  test(`a ${label} clear response shows an error without invalidating or refetching orders`, async () => {
    const client = getHomeQueryClient();
    const openOrderKey = ownerQueryKey(activityOwnerKey(session), "funding-open-order", "US");
    client.setQueryData(openOrderKey, { id: "fixture-funding-ambiguous" });
    const { view, requests } = setup({ resolveBody });
    await openOrder(view, "30");
    fireEvent.click(await view.findByRole("button", { name: "Clear order" }));
    await waitFor(() => expect(view.getByText("Could not clear the order. Try again.")).toBeTruthy());
    expect(requests.filter(({ method }) => method === "POST").map(({ path }) => path))
      .toEqual(["/api/funding/orders/fixture-funding-ambiguous/resolve"]);
    expect(client.getQueryState(openOrderKey)?.isInvalidated).toBe(false);
    expect(requests.filter(({ path }) => path === "/api/activity/orders")).toHaveLength(1);
  });
}

test("returned funds review the withdrawal against the order deposit ID in the same sheet", async () => {
  const { view, prepared, flows } = setup({ fallback: true });
  const cashout = activityOrdersFixture().orders.find((order) => order.kind === "cash-out")!;
  if (cashout.kind !== "cash-out") throw new Error("Fixture is not a cash-out");
  const button = await view.findByRole("button", { name: /Cash out to Cash App.*\$25/ });
  fireEvent.click(button);
  const dialog = await view.findByRole("dialog", { name: /Cash out to Cash App/ });
  fireEvent.click(within(dialog).getByRole("button", { name: /Withdraw \$25/ }));
  await waitFor(() => expect(prepared).toEqual([{ kind: "cash-out-withdraw", params: {
    providerId: "peer", region: "US", depositId: cashout.orderId,
  } }]));
  await within(dialog).findByRole("button", { name: "Withdraw $50.00" });
  expect(within(dialog).getByText("Confirm withdrawal")).toBeTruthy();
  expect(flows).toEqual([]);
});

test("a waiting cash-out order offers cancel against the order deposit ID", async () => {
  const { view, prepared } = setup({ fallback: "waiting" });
  const cashout = activityOrdersFixture().orders.find((order) => order.kind === "cash-out")!;
  if (cashout.kind !== "cash-out") throw new Error("Fixture is not a cash-out");
  fireEvent.click(await view.findByRole("button", { name: /Cash out to Cash App.*\$25/ }));
  fireEvent.click(await view.findByRole("button", { name: /Cancel cash-out \$25/ }));
  await waitFor(() => expect(prepared).toEqual([{ kind: "cash-out-withdraw", params: {
    providerId: "peer", region: "US", depositId: cashout.orderId,
  } }]));
});

test("an orders source error keeps action rows and offers page retry", async () => {
  const { view } = setup({ failOrders: true });
  await waitFor(() => expect(view.getByText("Add money and cash-out orders are unavailable.")).toBeTruthy());
  expect(view.getByRole("button", { name: "Retry orders" })).toBeTruthy();
  expect(view.getByText("Cash out to Cash App")).toBeTruthy();
});

test("an orders source error joins the Home feed partial-source status", async () => {
  const { view } = setup({ failOrders: true, density: "feed" });
  await waitFor(() => expect(view.getByText("Some activity is unavailable")).toBeTruthy());
  expect(view.getByText("Cash out to Cash App")).toBeTruthy();
});
