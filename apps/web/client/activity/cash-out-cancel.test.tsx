import "@/client/account/dom-test-harness";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { AccountWalletContext, type AccountWalletClient } from "@/client/account/cdp-client";
import { HomeShellRoutingProvider, type HomeInboundPanelState } from "@/client/home/panel-routing";
import { ConnectedActivityPanel } from "@/client/home/activity-panel";
import { getHomeQueryClient } from "@/client/query/query-client";
import { cashoutFixtureAction, cashoutFixtureWithdraw } from "@/tests/browser/feature-map/cashout-fixture";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { NETWORK_FEE_UNFUNDED_CODE, NETWORK_FEE_UNFUNDED_MESSAGE } from "@/shared/money-actions/network-fee";

const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
beforeEach(() => { (globalThis as { BASE_UI_ANIMATIONS_DISABLED?: boolean }).BASE_UI_ANIMATIONS_DISABLED = true; });
afterEach(() => { cleanup(); getHomeQueryClient().clear(); delete (globalThis as { BASE_UI_ANIMATIONS_DISABLED?: boolean }).BASE_UI_ANIMATIONS_DISABLED; });
const session = { user: { subject: cashoutFixtureAction.owner.subject }, smartAccount: { address: cashoutFixtureAction.owner.address as `0x${string}`, chainId: 8453 as const }, accountProvider: "cdp-embedded" as const };

function setup(prepare: AccountWalletClient["prepareMoneyAction"]) {
  const calls: Array<{ kind: string; params: unknown }> = [];
  const routes: Array<{ flow: string; options: unknown }> = [];
  const wallet = { prepareMoneyAction: async (kind: string, params: unknown) => { calls.push({ kind, params }); return prepare(kind, params); } } as AccountWalletClient;
  const routing = { state: {} as HomeInboundPanelState, popRevision: 0, rootRequest: null,
    openPanel: () => {},
    setFlow: (flow: string, options: unknown) => { routes.push({ flow, options }); return true; },
    clearFlow: () => {},
  };
  const view = render(<AccountWalletContext.Provider value={wallet}><HomeShellRoutingProvider value={routing}>
    <ConnectedActivityPanel density="page" activitySession={session} fetchActivity={async () => { throw new Error("Unavailable"); }}
      fetchOperations={async () => ({ actions: [cashoutFixtureAction] })} regionId="US" />
  </HomeShellRoutingProvider></AccountWalletContext.Provider>);
  return { view, calls, routes };
}
async function openDetails(view: ReturnType<typeof render>) {
  const row = await view.findByRole("button", { name: /\$50 to Cash App.*Waiting for a buyer/ });
  fireEvent.click(row);
  return view.findByRole("dialog", { name: "$50 to Cash App" });
}

test("Cancel prepares the unclaimed deposit amount and opens the existing Send review", async () => {
  const { view, calls, routes } = setup(async () => cashoutFixtureWithdraw as PreparedMoneyAction);
  await openDetails(view);
  fireEvent.click(await view.findByRole("button", { name: "Cancel cash-out $50" }));
  await waitFor(() => expect(calls).toEqual([{ kind: "cash-out-withdraw", params: { providerId: "peer", region: "US", depositId: "fixture-escrow-1" } }]));
  await waitFor(() => expect(routes).toEqual([{ flow: "send", options: { actionId: cashoutFixtureWithdraw.id, mode: "push" } }]));
  await waitFor(() => expect(view.queryByRole("dialog", { name: "$50 to Cash App" })).toBeNull());
});

test("failed prepare keeps the detail open with an inline error", async () => {
  const { view, routes } = setup(async () => { throw new Error("offline"); });
  const dialog = await openDetails(view);
  fireEvent.click(await view.findByRole("button", { name: "Cancel cash-out $50" }));
  await waitFor(() => expect(view.getByRole("alert").textContent).toContain("Could not prepare the withdrawal. Try again."));
  expect(routes).toEqual([]);
  expect(dialog.isConnected).toBe(true);
});

test("an unfunded network fee names the fee instead of a generic prepare error", async () => {
  const { view, routes } = setup(async () => { throw Object.assign(new Error("unfunded"), { code: NETWORK_FEE_UNFUNDED_CODE }); });
  await openDetails(view);
  fireEvent.click(await view.findByRole("button", { name: "Cancel cash-out $50" }));
  await waitFor(() => expect(view.getByRole("alert").textContent).toContain(NETWORK_FEE_UNFUNDED_MESSAGE));
  expect(routes).toEqual([]);
});

test("an unavailable network fee names the fee instead of a generic prepare error", async () => {
  const { view, routes } = setup(async () => { throw Object.assign(new Error("fee"), { status: 502, code: "NETWORK_FEE_UNAVAILABLE", serverMessage: "The network fee could not be checked. Try again." }); });
  await openDetails(view);
  fireEvent.click(await view.findByRole("button", { name: "Cancel cash-out $50" }));
  await waitFor(() => expect(view.getByRole("alert").textContent).toContain("The network fee could not be checked. Try again."));
  expect(routes).toEqual([]);
});

test("closing the details clears a previous cancellation error", async () => {
  const { view } = setup(async () => { throw new Error("offline"); });
  await openDetails(view);
  fireEvent.click(await view.findByRole("button", { name: "Cancel cash-out $50" }));
  await waitFor(() => expect(view.getByRole("alert").textContent).toContain("Could not prepare the withdrawal. Try again."));
  fireEvent.click(view.getByRole("button", { name: "Close transaction details" }));
  await waitFor(() => expect(view.queryByRole("dialog", { name: "$50 to Cash App" })).toBeNull());
  await openDetails(view);
  expect(await view.findByRole("button", { name: "Cancel cash-out $50" })).toBeTruthy();
  expect(view.queryByRole("alert")).toBeNull();
});

test("a cancellation that settles after the details close neither shows its error nor opens review", async () => {
  let reject: (error: Error) => void = () => {};
  const { view, routes } = setup(() => new Promise((_resolve, fail) => { reject = fail; }));
  await openDetails(view);
  fireEvent.click(await view.findByRole("button", { name: "Cancel cash-out $50" }));
  fireEvent.click(view.getByRole("button", { name: "Close transaction details" }));
  await waitFor(() => expect(view.queryByRole("dialog", { name: "$50 to Cash App" })).toBeNull());
  await openDetails(view);
  reject(new Error("offline"));
  await waitFor(() => expect(view.getByRole("button", { name: "Cancel cash-out $50" }).hasAttribute("disabled")).toBe(false));
  expect(view.queryByRole("alert")).toBeNull();
  expect(routes).toEqual([]);
});
