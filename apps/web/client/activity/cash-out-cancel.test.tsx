import "@/client/account/dom-test-harness";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { AccountWalletContext, type AccountWalletClient } from "@/client/account/cdp-client";
import { HomeShellRoutingProvider, type HomeInboundPanelState } from "@/client/home/panel-routing";
import { ConnectedActivityPanel } from "@/client/home/activity-panel";
import { getHomeQueryClient } from "@/client/query/query-client";
import { cashoutFixtureAction, cashoutFixtureWithdraw } from "@/tests/browser/feature-map/cashout-fixture";
import type { PreparedMoneyAction, OperationResult } from "@/shared/money-actions/types";
import { MONEY_ACTION_ID_ATTRIBUTE } from "@/shared/money-actions";
import { NETWORK_FEE_UNFUNDED_CODE, NETWORK_FEE_UNFUNDED_MESSAGE } from "@/shared/money-actions/network-fee";
import { TransferExecutionError } from "@/shared/transfers/types";
import type { ReactNode } from "react";

const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
beforeEach(() => { (globalThis as { BASE_UI_ANIMATIONS_DISABLED?: boolean }).BASE_UI_ANIMATIONS_DISABLED = true; });
afterEach(() => { cleanup(); getHomeQueryClient().clear(); delete (globalThis as { BASE_UI_ANIMATIONS_DISABLED?: boolean }).BASE_UI_ANIMATIONS_DISABLED; });
const session = { user: { subject: cashoutFixtureAction.owner.subject }, smartAccount: { address: cashoutFixtureAction.owner.address as `0x${string}`, chainId: 8453 as const }, accountProvider: "cdp-embedded" as const };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function ActivityProviders({ wallet, routing, children }: { wallet: AccountWalletClient; routing: Parameters<typeof HomeShellRoutingProvider>[0]["value"]; children: ReactNode }) {
  return <AccountWalletContext.Provider value={wallet}><HomeShellRoutingProvider value={routing}>{children}</HomeShellRoutingProvider></AccountWalletContext.Provider>;
}

function setup(prepare: AccountWalletClient["prepareMoneyAction"], execute: AccountWalletClient["executeMoneyAction"] = async () => ({ id: cashoutFixtureWithdraw.id, status: "submitted" }), actions: unknown[] = [cashoutFixtureAction]) {
  const calls: Array<{ kind: string; params: unknown }> = [];
  const dispatches: PreparedMoneyAction[] = [];
  const routes: Array<{ flow: string; options: unknown }> = [];
  const wallet = { prepareMoneyAction: async (kind: string, params: unknown) => { calls.push({ kind, params }); return prepare(kind, params); },
    executeMoneyAction: async (action: PreparedMoneyAction) => { dispatches.push(action); return execute(action); } } as AccountWalletClient;
  const routing = { state: {} as HomeInboundPanelState, activityReturn: null, popRevision: 0, rootRequest: null,
    openPanel: () => {}, canOpenAssetDetail: () => false, openAssetDetail: () => false,
    setFlow: (flow: string, options: unknown) => { routes.push({ flow, options }); return true; }, clearFlow: () => {},
    pushRoute: () => {}, leaveRoute: () => {},
  };
  const panel = (owner = session) => <ActivityProviders wallet={wallet} routing={routing}>
    <ConnectedActivityPanel density="page" activitySession={owner} fetchActivity={async () => { throw new Error("Unavailable"); }}
      fetchOperations={async () => ({ actions })} regionId="US" />
  </ActivityProviders>;
  const view = render(panel());
  return { view, calls, routes, dispatches, panel };
}
async function openDetails(view: ReturnType<typeof render>) {
  const row = await view.findByRole("button", { description: "View Cash out to Cash App details" });
  fireEvent.click(row);
  return view.findByRole("dialog", { name: "Cash out to Cash App" });
}

const cancelLabel = "Cancel cash-out $50";

test("preparation shows busy progress without changing or closing the detail sheet", async () => {
  const pending = deferred<PreparedMoneyAction>();
  const { view, calls, routes } = setup(() => pending.promise);
  const dialog = await openDetails(view);
  const button = within(dialog).getByRole("button", { name: cancelLabel });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(button.querySelector("svg")).not.toBeNull();
  expect(button.textContent).toBe(cancelLabel);
  expect(within(dialog).getByText("Cash out to Cash App")).toBeTruthy();
  expect(dialog.isConnected).toBe(true);
  expect(calls).toEqual([{ kind: "cash-out-withdraw", params: { providerId: "peer", region: "US", depositId: "fixture-escrow-1" } }]);
  expect(routes).toEqual([]);
  await act(async () => pending.resolve(cashoutFixtureWithdraw as PreparedMoneyAction));
});

test("prepared withdrawal reviews exactly once in the same dialog with its action id and no Send route", async () => {
  const { view, calls, routes } = setup(async () => cashoutFixtureWithdraw as PreparedMoneyAction);
  const dialog = await openDetails(view);
  fireEvent.click(within(dialog).getByRole("button", { name: cancelLabel }));
  const confirm = await within(dialog).findByRole("button", { name: "Withdraw $50.00" });
  expect(confirm.getAttribute(MONEY_ACTION_ID_ATTRIBUTE)).toBe(cashoutFixtureWithdraw.id);
  expect(within(dialog).getByText("Confirm withdrawal")).toBeTruthy();
  expect(within(dialog).queryByRole("button", { name: cancelLabel })).toBeNull();
  expect(within(dialog).queryByText("Order ID")).toBeNull();
  expect(view.getAllByRole("dialog")).toHaveLength(1);
  expect(dialog.isConnected).toBe(true);
  expect(calls).toHaveLength(1);
  expect(routes).toEqual([]);
});

test("failed prepare keeps the detail open with an inline error and usable retry", async () => {
  let failures = 0;
  const { view, calls, routes } = setup(async () => {
    if (failures++ === 0) throw new Error("offline");
    return cashoutFixtureWithdraw as PreparedMoneyAction;
  });
  const dialog = await openDetails(view);
  fireEvent.click(within(dialog).getByRole("button", { name: cancelLabel }));
  await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain("Could not prepare the withdrawal. Try again."));
  const retry = within(dialog).getByRole("button", { name: cancelLabel });
  expect(retry.hasAttribute("disabled")).toBe(false);
  expect(retry.getAttribute("aria-busy")).not.toBe("true");
  expect(dialog.isConnected).toBe(true);
  fireEvent.click(retry);
  await within(dialog).findByRole("button", { name: "Withdraw $50.00" });
  expect(calls).toHaveLength(2);
  expect(routes).toEqual([]);
});

test("an unfunded network fee names the fee instead of a generic prepare error", async () => {
  const { view, routes } = setup(async () => { throw Object.assign(new Error("unfunded"), { code: NETWORK_FEE_UNFUNDED_CODE }); });
  await openDetails(view);
  fireEvent.click(await view.findByRole("button", { name: cancelLabel }));
  await waitFor(() => expect(view.getByRole("alert").textContent).toContain(NETWORK_FEE_UNFUNDED_MESSAGE));
  expect(routes).toEqual([]);
});

test("an unavailable network fee names the fee instead of a generic prepare error", async () => {
  const { view, routes } = setup(async () => { throw Object.assign(new Error("fee"), { status: 502, code: "NETWORK_FEE_UNAVAILABLE", serverMessage: "The network fee could not be checked. Try again." }); });
  await openDetails(view);
  fireEvent.click(await view.findByRole("button", { name: cancelLabel }));
  await waitFor(() => expect(view.getByRole("alert").textContent).toContain("The network fee could not be checked. Try again."));
  expect(routes).toEqual([]);
});

test("mismatched prepared metadata never exposes a confirm action", async () => {
  const { view, dispatches } = setup(async () => ({ ...cashoutFixtureWithdraw, metadata: { ...cashoutFixtureWithdraw.metadata, operation: "deposit" } }) as unknown as PreparedMoneyAction);
  const dialog = await openDetails(view);
  fireEvent.click(within(dialog).getByRole("button", { name: cancelLabel }));
  await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain("Cash-out withdrawal review is unavailable. Try again."));
  expect(within(dialog).queryByRole("button", { name: "Withdraw $50.00" })).toBeNull();
  expect(dispatches).toHaveLength(0);
});

test("a prepared action without a receive amount never exposes a confirm action", async () => {
  const { view, dispatches } = setup(async () => ({ ...cashoutFixtureWithdraw, amounts: [] }) as PreparedMoneyAction);
  const dialog = await openDetails(view);
  fireEvent.click(within(dialog).getByRole("button", { name: cancelLabel }));
  await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain("Cash-out withdrawal review is unavailable. Try again."));
  expect(within(dialog).queryByRole("button", { name: /^Withdraw/ })).toBeNull();
  expect(dispatches).toHaveLength(0);
});

test("closing the details clears a previous cancellation error", async () => {
  const { view } = setup(async () => { throw new Error("offline"); });
  await openDetails(view);
  fireEvent.click(await view.findByRole("button", { name: cancelLabel }));
  await waitFor(() => expect(view.getByRole("alert").textContent).toContain("Could not prepare the withdrawal. Try again."));
  fireEvent.click(view.getByRole("button", { name: "Close Cash out to Cash App details" }));
  await waitFor(() => expect(view.queryByRole("dialog", { name: "Cash out to Cash App" })).toBeNull());
  await openDetails(view);
  expect(await view.findByRole("button", { name: cancelLabel })).toBeTruthy();
  expect(view.queryByRole("alert")).toBeNull();
});

test("closing the sheet while preparing discards late success and error before reopening", async () => {
  const pending = deferred<PreparedMoneyAction>();
  const { view, routes } = setup(() => pending.promise);
  await openDetails(view);
  fireEvent.click(view.getByRole("button", { name: cancelLabel }));
  fireEvent.click(view.getByRole("button", { name: "Close Cash out to Cash App details" }));
  await waitFor(() => expect(view.queryByRole("dialog", { name: "Cash out to Cash App" })).toBeNull());
  await act(async () => pending.resolve(cashoutFixtureWithdraw as PreparedMoneyAction));
  const dialog = await openDetails(view);
  expect(within(dialog).getByRole("button", { name: cancelLabel }).getAttribute("aria-busy")).not.toBe("true");
  expect(within(dialog).queryByRole("button", { name: "Withdraw $50.00" })).toBeNull();
  expect(within(dialog).queryByRole("alert")).toBeNull();
  expect(routes).toEqual([]);
});

test("a cancellation that rejects after the detail closes never shows its error or opens review", async () => {
  const pending = deferred<PreparedMoneyAction>();
  const { view, routes } = setup(() => pending.promise);
  await openDetails(view);
  fireEvent.click(view.getByRole("button", { name: cancelLabel }));
  fireEvent.click(view.getByRole("button", { name: "Close Cash out to Cash App details" }));
  await waitFor(() => expect(view.queryByRole("dialog", { name: "Cash out to Cash App" })).toBeNull());
  await act(async () => pending.reject(new Error("offline")));
  const dialog = await openDetails(view);
  expect(within(dialog).queryByRole("alert")).toBeNull();
  expect(within(dialog).queryByRole("button", { name: "Withdraw $50.00" })).toBeNull();
  expect(routes).toEqual([]);
});

test("owner change during preparation discards the late result and clears the journey", async () => {
  const pending = deferred<PreparedMoneyAction>();
  const { view, routes, panel } = setup(() => pending.promise);
  await openDetails(view);
  fireEvent.click(view.getByRole("button", { name: cancelLabel }));
  const other = { ...session, user: { subject: "other-owner" } };
  view.rerender(panel(other));
  await act(async () => pending.resolve(cashoutFixtureWithdraw as PreparedMoneyAction));
  view.rerender(panel());
  const dialog = await openDetails(view);
  expect(within(dialog).queryByRole("button", { name: "Withdraw $50.00" })).toBeNull();
  expect(within(dialog).queryByRole("alert")).toBeNull();
  expect(within(dialog).getByRole("button", { name: cancelLabel }).getAttribute("aria-busy")).not.toBe("true");
  expect(routes).toEqual([]);
});

test("changing details while preparing discards the late review without changing the new detail", async () => {
  const pending = deferred<PreparedMoneyAction>();
  const anotherAction = { ...cashoutFixtureAction, id: "90100000-0000-4000-8000-000000000003",
    cashout: { ...cashoutFixtureAction.cashout, depositId: "fixture-escrow-2" } };
  const { view, routes } = setup(() => pending.promise, undefined, [cashoutFixtureAction, anotherAction]);
  const rows = await view.findAllByRole("button", { description: "View Cash out to Cash App details" });
  fireEvent.click(rows[0]!);
  const dialog = await view.findByRole("dialog", { name: "Cash out to Cash App" });
  fireEvent.click(within(dialog).getByRole("button", { name: cancelLabel }));
  fireEvent.click(rows[1]!);
  await act(async () => pending.resolve(cashoutFixtureWithdraw as PreparedMoneyAction));
  expect(within(dialog).queryByRole("button", { name: "Withdraw $50.00" })).toBeNull();
  expect(within(dialog).queryByRole("alert")).toBeNull();
  expect(within(dialog).getByRole("button", { name: cancelLabel }).getAttribute("aria-busy")).not.toBe("true");
  expect(routes).toEqual([]);
});

test("wallet rejection returns to the review with a working explicit retry", async () => {
  let attempts = 0;
  const { view, dispatches } = setup(async () => cashoutFixtureWithdraw as PreparedMoneyAction,
    async () => ({ id: cashoutFixtureWithdraw.id, status: ++attempts === 1 ? "rejected" : "submitted" }));
  const dialog = await openDetails(view);
  fireEvent.click(within(dialog).getByRole("button", { name: cancelLabel }));
  fireEvent.click(await within(dialog).findByRole("button", { name: "Withdraw $50.00" }));
  await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain("The wallet request was rejected."));
  const retry = within(dialog).getByRole("button", { name: "Withdraw $50.00" });
  expect(retry.getAttribute(MONEY_ACTION_ID_ATTRIBUTE)).toBe(cashoutFixtureWithdraw.id);
  fireEvent.click(retry);
  expect(await within(dialog).findByText("Returning $50.00 to your account")).toBeTruthy();
  expect(dispatches).toHaveLength(2);
});

test("failed and uncertain dispatch outcomes use the shared result without an automatic retry", async () => {
  for (const outcome of ["failed", "uncertain"] as const) {
    const { view, dispatches } = setup(async () => cashoutFixtureWithdraw as PreparedMoneyAction,
      async () => {
        if (outcome === "uncertain") throw new TransferExecutionError("dispatch-unknown");
        return { id: cashoutFixtureWithdraw.id, status: "failed" };
      });
    const dialog = await openDetails(view);
    fireEvent.click(within(dialog).getByRole("button", { name: cancelLabel }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "Withdraw $50.00" }));
    expect(await within(dialog).findByRole("button", { name: outcome === "failed" ? "Try again" : "View in Activity" })).toBeTruthy();
    expect(dispatches).toHaveLength(1);
    view.unmount();
    getHomeQueryClient().clear();
  }
});

test("confirmation dispatches once, locks the pending sheet, and reaches the result", async () => {
  const pending = deferred<OperationResult>();
  const { view, dispatches, routes } = setup(async () => cashoutFixtureWithdraw as PreparedMoneyAction, () => pending.promise);
  const dialog = await openDetails(view);
  fireEvent.click(within(dialog).getByRole("button", { name: cancelLabel }));
  const confirm = await within(dialog).findByRole("button", { name: "Withdraw $50.00" });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(dispatches).toHaveLength(1);
  expect(within(dialog).getByRole("button", { name: "Close withdrawal review" }).hasAttribute("disabled")).toBe(true);
  expect(confirm.getAttribute("aria-busy")).toBe("true");
  await act(async () => pending.resolve({ id: cashoutFixtureWithdraw.id, status: "submitted" }));
  expect(await within(dialog).findByText("Returning $50.00 to your account")).toBeTruthy();
  expect(view.getAllByRole("dialog")).toHaveLength(1);
  expect(dispatches).toHaveLength(1);
  expect(routes).toEqual([]);
});

test("an expired review blocks dispatch and returns to the details step", async () => {
  const { view, dispatches } = setup(async () => ({ ...cashoutFixtureWithdraw, expiresAt: "2000-01-01T00:00:00.000Z" }) as PreparedMoneyAction);
  const dialog = await openDetails(view);
  fireEvent.click(within(dialog).getByRole("button", { name: cancelLabel }));
  const confirm = await within(dialog).findByRole("button", { name: "Withdraw $50.00" });
  await waitFor(() => expect(confirm.hasAttribute("disabled")).toBe(true));
  expect(within(dialog).getByRole("alert").textContent).toContain("This review expired. Go back and continue again.");
  fireEvent.click(confirm);
  expect(dispatches).toHaveLength(0);
  fireEvent.click(within(dialog).getAllByRole("button", { name: "Back" }).at(-1)!);
  await waitFor(() => expect(within(dialog).getByRole("button", { name: cancelLabel })).toBeTruthy());
  expect(within(dialog).queryByRole("alert")).toBeNull();
});

test("an unavailable review leaves the journey with an actionable message", async () => {
  const { view, dispatches } = setup(async () => cashoutFixtureWithdraw as PreparedMoneyAction,
    async () => { throw Object.assign(new TransferExecutionError("unavailable"), { status: 410 }); });
  const dialog = await openDetails(view);
  fireEvent.click(within(dialog).getByRole("button", { name: cancelLabel }));
  fireEvent.click(await within(dialog).findByRole("button", { name: "Withdraw $50.00" }));
  await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain("This review is no longer available — start again."));
  expect(within(dialog).queryByRole("button", { name: "Withdraw $50.00" })).toBeNull();
  expect(within(dialog).getByRole("button", { name: cancelLabel })).toBeTruthy();
  expect(dispatches).toHaveLength(1);
});
