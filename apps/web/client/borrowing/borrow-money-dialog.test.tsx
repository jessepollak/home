import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { HomeShellRoutingProvider, type HomeShellRouting } from "@/client/home/panel-routing";
import { getHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { TransferExecutionError } from "@/shared/transfers/types";
import { borrowOverviewBody, sessionBody } from "@/tests/browser/fixtures/bodies";

const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { BorrowMoneyDialog } = await import("./borrow-money-dialog");

const session = sessionBody as VerifiedAccountSession;
const availability = borrowOverviewBody().opportunities[2]!.availability;
if (availability.status !== "available") throw new Error("Borrow fixture unavailable");
const snapshot = availability.snapshot;
const action: PreparedMoneyAction = {
  id: "11111111-1111-4111-8111-111111111111",
  owner: { subject: session.user.subject, address: session.smartAccount!.address, chainId: 8453, accountProvider: session.accountProvider },
  kind: "borrow", title: "Borrow USDC", calls: [], warnings: [],
  amounts: [{ assetId: snapshot.market.loanToken.id, symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "receive" }],
  metadata: { product: "borrow", operation: "borrow", marketId: snapshot.market.id, loanAsset: { id: snapshot.market.loanToken.id, symbol: "USDC" }, collateralAsset: { id: snapshot.market.collateralToken.id, symbol: snapshot.market.collateralToken.symbol }, projectedHealthFactorWad: null, projectedLiquidationPriceRaw: null, borrowAprWad: "31536000000000000", source: { blockNumber: "100", blockHash: snapshot.source.blockHash, blockTimestamp: "1788897600" } },
  createdAt: new Date().toISOString(), expiresAt: "2099-01-01T00:00:00.000Z",
};
const key = ownerQueryKey(dataOwnerKey(session), "actions");
const row = { id: action.id, owner: action.owner, status: "pending" };

function mount({ prepare = async () => action, execute = async () => ({ id: action.id, status: "submitted" as const }), fetch = async () => ({ actions: [] }), close = () => {}, openPanel = () => {} }: {
  prepare?: () => Promise<PreparedMoneyAction>;
  execute?: (prepared: PreparedMoneyAction) => Promise<{ id: string; status: "submitted" | "failed" | "rejected" }>;
  fetch?: (path: string) => Promise<unknown>;
  close?: () => void;
  openPanel?: (panel: string) => void;
} = {}) {
  const routing = { openPanel } as HomeShellRouting;
  render(<HomeShellRoutingProvider value={routing}><BorrowMoneyDialog session={session} snapshot={snapshot} operation="borrow" regionId="US" fetchAccountResource={async (path) => path === "/api/actions/network-fee" ? { version: 1, usdcReserveBaseUnits: null } : fetch(path)} prepareMoneyAction={prepare} executeMoneyAction={execute} onClose={close} /></HomeShellRoutingProvider>);
  return within(document.body);
}

async function review(body: ReturnType<typeof within>) {
  const dialog = within(await body.findByRole("dialog", { name: "Borrow" }));
  fireEvent.change(dialog.getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
  fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
  return { dialog, confirm: await dialog.findByRole("button", { name: "Confirm action" }) };
}

afterEach(() => { cleanup(); getHomeQueryClient().clear(); });

describe("Borrow action result", () => {
  test("submitting keeps the focused marked button busy and ignores a second press", async () => {
    let finish!: (value: { id: string; status: "submitted" }) => void;
    let calls = 0;
    const body = mount({ execute: async () => { calls++; return new Promise((resolve) => { finish = resolve; }); } });
    const { dialog, confirm } = await review(body);
    confirm.focus();
    fireEvent.click(confirm);
    expect(dialog.getByRole("button", { name: "Confirm action" })).toBe(confirm);
    expect(confirm.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(confirm);
    expect(dialog.getByRole("button", { name: "Close Borrow action" }).hasAttribute("disabled")).toBe(true);
    expect(dialog.queryByText("Waiting for your wallet…")).toBeNull();
    fireEvent.click(confirm);
    expect(calls).toBe(1);
    await act(async () => finish({ id: action.id, status: "submitted" }));
    expect(await dialog.findByText("Borrowing 1 USDC")).toBeTruthy();
  });

  test("submitted is pending with two real stages; another owner cannot confirm it, but its own confirmed row can", async () => {
    const body = mount();
    const { dialog, confirm } = await review(body);
    fireEvent.click(confirm);
    expect(await dialog.findByText("Borrowing 1 USDC")).toBeTruthy();
    expect(dialog.getAllByRole("listitem")).toHaveLength(2);
    expect(dialog.getByText("Submitted")).toBeTruthy();
    expect(dialog.getByText("Confirming on Base")).toBeTruthy();
    expect(dialog.getByRole("button", { name: "Done" })).toBeTruthy();
    expect(dialog.getByRole("button", { name: "View in Activity" })).toBeTruthy();
    expect(dialog.queryByRole("button", { name: "Back" })).toBeNull();
    expect(dialog.getByRole("button", { name: "Close Borrow action" }).hasAttribute("disabled")).toBe(false);
    await act(async () => { getHomeQueryClient().setQueryData(key, { actions: [{ ...row, owner: { ...row.owner, subject: "another" }, status: "confirmed" }] }); });
    expect(dialog.getByText("Borrowing 1 USDC")).toBeTruthy();
    await act(async () => { getHomeQueryClient().setQueryData(key, { actions: [{ ...row, status: "confirmed" }] }); });
    expect(await dialog.findByText("Borrowed 1 USDC")).toBeTruthy();
    expect(dialog.queryByText("Confirming on Base")).toBeNull();
    expect(dialog.getByRole("button", { name: "Done" })).toBeTruthy();
  });

  test("failed row permits a fresh review while preserving the entered amount", async () => {
    let prepares = 0;
    const body = mount({ prepare: async () => { prepares++; return action; } });
    const { dialog, confirm } = await review(body);
    fireEvent.click(confirm);
    await dialog.findByText("Borrowing 1 USDC");
    await act(async () => { getHomeQueryClient().setQueryData(key, { actions: [{ ...row, status: "failed" }] }); });
    expect(await dialog.findByText("Borrow didn't go through")).toBeTruthy();
    expect(dialog.getByText("Your Borrow position didn't change.")).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "Try again" }));
    expect(dialog.getByRole("button", { name: "Continue" })).toBeTruthy();
    expect(dialog.getByRole("img", { name: /1\.00/ })).toBeTruthy();
    expect(dialog.queryByRole("button", { name: "Confirm action" })).toBeNull();
    fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
    expect(await dialog.findByRole("button", { name: "Confirm action" })).toBeTruthy();
    expect(prepares).toBe(2);
  });

  test("typed failed result goes straight to failed without an actions read", async () => {
    let actionsReads = 0;
    const body = mount({ execute: async () => ({ id: action.id, status: "failed" }), fetch: async () => { actionsReads++; return { actions: [] }; } });
    const { dialog, confirm } = await review(body);
    fireEvent.click(confirm);
    expect(await dialog.findByText("Borrow didn't go through")).toBeTruthy();
    expect(actionsReads).toBe(0);
    expect(dialog.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  test.each(["submission-unknown", "dispatch-unknown"] as const)("%s is not retriable and routes to Activity after closing", async (reason) => {
    const events: string[] = [];
    const body = mount({ execute: async () => { throw new TransferExecutionError(reason); }, close: () => events.push("close"), openPanel: (panel) => events.push(panel) });
    const { dialog, confirm } = await review(body);
    fireEvent.click(confirm);
    expect(await dialog.findByText("We can't confirm 1 USDC")).toBeTruthy();
    expect(dialog.getByText("It may have gone through. Check Activity before trying again.")).toBeTruthy();
    expect(dialog.queryByRole("button", { name: /try again|retry/i })).toBeNull();
    expect(dialog.queryByText("Confirming on Base")).toBeNull();
    fireEvent.click(dialog.getByRole("button", { name: "View in Activity" }));
    expect(events).toEqual(["close"]);
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(events).toEqual(["close", "activity"]);
  });

  test("rejected stays on the existing error handling", async () => {
    const body = mount({ execute: async () => ({ id: action.id, status: "rejected" }) });
    const { dialog, confirm } = await review(body);
    fireEvent.click(confirm);
    expect(await dialog.findByText("The wallet request was rejected.")).toBeTruthy();
    expect(dialog.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(dialog.getAllByRole("button", { name: "Back" })).toBeTruthy();
  });

  test("other thrown failures retain Retry recording this same action", async () => {
    const body = mount({ execute: async () => { throw new TransferExecutionError("unavailable"); } });
    const { dialog, confirm } = await review(body);
    fireEvent.click(confirm);
    expect(await dialog.findByText(/Retry recording this same action/)).toBeTruthy();
    expect(dialog.getByRole("button", { name: "Retry" }).getAttribute("data-money-action-id")).toBe(action.id);
  });
});
