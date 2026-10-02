import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { afterEach, expect, test } from "bun:test";
import { useState } from "react";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { getHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import { HomeShellRoutingProvider, type HomeShellRouting } from "@/client/home/panel-routing";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { parseRecentActionsPayload } from "@/shared/actions/contracts/list";
import { encodeUsdcTransfer, getTransferAsset } from "@/shared/transfers/transfer-helpers";
import { TransferExecutionError } from "@/shared/transfers/types";

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { SendDialog } = await import("./send-dialog");

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const RECIPIENT = "0x2222222222222222222222222222222222222222" as const;
const ID = "11111111-1111-4111-8111-111111111111";
const action: PreparedMoneyAction = {
  id: ID, kind: "send", title: "Send USDC", createdAt: "2026-09-12T12:00:00.000Z", expiresAt: "2099-09-12T12:10:00.000Z",
  calls: [{ to: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", data: encodeUsdcTransfer(RECIPIENT, BigInt(1_000_000)), value: "0" }],
  amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "spend" }], warnings: [],
  owner: { subject: "subject-a", address: ACCOUNT, chainId: 8453, accountProvider: "cdp-embedded" },
};
const balance = { ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" };
const actionRow = (status: "confirmed" | "failed", owner = action.owner) => ({
  id: ID, status, owner, kind: action.kind, createdAt: action.createdAt, confirmedAt: action.createdAt,
  summary: { title: action.title, amounts: action.amounts, warnings: action.warnings, expiresAt: action.expiresAt },
});
const parsed = (rows: unknown[]) => parseRecentActionsPayload({ actions: rows }, {
  user: { subject: action.owner.subject },
  smartAccount: { address: action.owner.address, chainId: action.owner.chainId },
  accountProvider: action.owner.accountProvider,
});

afterEach(() => { cleanup(); getHomeQueryClient().clear(); });

test("paused send review still loads and explains an offer withdrawn at confirm", async () => {
  render(<SendDialog open immediate sendOffered={false} address={ACCOUNT} queryOwnerKey="offer-withdrawn" resumeActionId={ID} availableAssets={[balance]}
    prepareMoneyAction={async () => action} resumeMoneyAction={async () => action}
    executeMoneyAction={async () => { throw { status: 409, code: "PRODUCT_NOT_OFFERED" }; }}
    onClose={() => {}} />);
  fireEvent.click(await page().findByRole("button", { name: "Send $1.00" }));
  expect((await page().findByRole("alert")).textContent).toBe("This is no longer offered.");
});
test("submitted stays in the dialog, ignores a different owner, and adopts the matching confirmed row", async () => {
  const calls: string[] = [];
  let closeCount = 0;
  function Routed() {
    const [actionId, setActionId] = useState<string | null>(ID);
    return <SendDialog open immediate address={ACCOUNT} queryOwnerKey="result-submitted" resumeActionId={actionId}
      availableAssets={[balance]} prepareMoneyAction={async () => action} resumeMoneyAction={async () => action}
      executeMoneyAction={async () => ({ id: ID, status: "submitted" })}
      fetchAccountResource={async (url) => {
        calls.push(url);
        if (url === "/api/actions") return { actions: [actionRow("confirmed", { ...action.owner, subject: "someone-else" })] };
        return { version: 1, recipients: [] };
      }}
      onSubmitted={() => setActionId(null)} onClose={() => { closeCount++; }} />;
  }
  render(<Routed />);
  fireEvent.click(await page().findByRole("button", { name: "Send $1.00" }));
  expect(await page().findByRole("heading", { name: "$1.00 on its way" })).toBeTruthy();
  await waitFor(() => expect(calls).toContain("/api/actions"));
  expect(page().getAllByRole("listitem")).toHaveLength(2);
  expect(page().queryByRole("button", { name: "Back" })).toBeNull();
  expect((page().getByRole("button", { name: "Close send dialog" }) as HTMLButtonElement).disabled).toBe(false);
  expect(closeCount).toBe(0);
  await act(async () => { getHomeQueryClient().setQueryData(ownerQueryKey(dataOwnerKey({ subject: action.owner.subject, smartAccountAddress: action.owner.address, chainId: action.owner.chainId, accountProvider: action.owner.accountProvider }), "actions"), parsed([actionRow("confirmed")])); });
  expect(await page().findByRole("heading", { name: "$1.00 sent" })).toBeTruthy();
});

test("submitted result becomes success for a matching confirmed row", async () => {
  let closes = 0;
  render(<SendDialog open immediate address={ACCOUNT} queryOwnerKey="result-success" resumeActionId={ID}
    prepareMoneyAction={async () => action} resumeMoneyAction={async () => action}
    executeMoneyAction={async () => ({ id: ID, status: "submitted" })}
    fetchAccountResource={async (url) => url === "/api/actions" ? { actions: [actionRow("confirmed")] } : { version: 1, recipients: [] }}
    onClose={() => { closes++; }} />);
  fireEvent.click(await page().findByRole("button", { name: "Send $1.00" }));
  expect(await page().findByRole("heading", { name: "$1.00 sent" })).toBeTruthy();
  expect(page().queryByText("Confirming on Base")).toBeNull();
  fireEvent.click(page().getByRole("button", { name: "Done" }));
  expect(closes).toBe(1);
});

test("repeated confirmation observations do not repeat the submission side effect", async () => {
  let submitted = 0;
  const key = ownerQueryKey(dataOwnerKey({ subject: action.owner.subject, smartAccountAddress: action.owner.address, chainId: action.owner.chainId, accountProvider: action.owner.accountProvider }), "actions");
  render(<SendDialog open immediate address={ACCOUNT} queryOwnerKey="result-repeat" resumeActionId={ID}
    prepareMoneyAction={async () => action} resumeMoneyAction={async () => action}
    executeMoneyAction={async () => ({ id: ID, status: "submitted" })}
    fetchAccountResource={async (url) => url === "/api/actions" ? { actions: [actionRow("confirmed")] } : { version: 1, recipients: [] }}
    onSubmitted={() => { submitted++; }} onClose={() => {}} />);
  fireEvent.click(await page().findByRole("button", { name: "Send $1.00" }));
  expect(await page().findByRole("heading", { name: "$1.00 sent" })).toBeTruthy();
  void act(() => getHomeQueryClient().setQueryData(key, parsed([])));
  expect(page().getByRole("heading", { name: "$1.00 sent" })).toBeTruthy();
  void act(() => getHomeQueryClient().setQueryData(key, parsed([actionRow("confirmed")])));
  expect(page().getByRole("heading", { name: "$1.00 sent" })).toBeTruthy();
  expect(submitted).toBe(1);
});

test("matching failed row offers Try again with the previous amount and clears review", async () => {
  let cleared = 0;
  render(<SendDialog open immediate address={ACCOUNT} queryOwnerKey="result-failed" resumeActionId={ID} availableAssets={[balance]}
    prepareMoneyAction={async () => action} resumeMoneyAction={async () => action}
    executeMoneyAction={async () => ({ id: ID, status: "submitted" })}
    fetchAccountResource={async (url) => url === "/api/actions" ? { actions: [actionRow("failed")] } : { version: 1, recipients: [] }}
    onInvalidResume={() => { cleared++; }} onClose={() => {}} />);
  fireEvent.click(await page().findByRole("button", { name: "Send $1.00" }));
  expect(await page().findByRole("heading", { name: "$1.00 wasn't sent" })).toBeTruthy();
  fireEvent.click(page().getByRole("button", { name: "Try again" }));
  expect(page().getByRole("button", { name: "Continue" })).toBeTruthy();
  expect((page().getByRole("textbox", { name: "Amount" }) as HTMLInputElement).value).toBe("1");
  expect(cleared).toBe(1);
});

test("ambiguous result clears the route and opens Activity after closing, without retry", async () => {
  const events: string[] = [];
  const routing = {
    state: { flow: "send", panel: "home" },
    openPanel: (panel: string) => { events.push(`panel:${panel}`); },
  } as HomeShellRouting;
  render(<HomeShellRoutingProvider value={routing}><SendDialog open immediate address={ACCOUNT} queryOwnerKey="result-unknown" resumeActionId={ID}
    prepareMoneyAction={async () => action} resumeMoneyAction={async () => action}
    executeMoneyAction={async () => { throw new TransferExecutionError("submission-unknown"); }}
    onSubmitted={() => events.push("clear-id")} onClose={() => events.push("close")} /></HomeShellRoutingProvider>);
  fireEvent.click(await page().findByRole("button", { name: "Send $1.00" }));
  expect(await page().findByRole("heading", { name: "We can't confirm $1.00" })).toBeTruthy();
  expect(events).toEqual(["clear-id"]);
  expect(page().queryByRole("button", { name: /try again|retry/i })).toBeNull();
  fireEvent.click(page().getByRole("button", { name: "View in Activity" }));
  expect(events).toEqual(["clear-id", "close"]);
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(events).toEqual(["clear-id", "close", "panel:activity"]);
});

test("double activation of Send confirm dispatches one execute", async () => {
  let finish!: (value: { id: string; status: "submitted" }) => void;
  const executions: string[] = [];
  render(<SendDialog open immediate address={ACCOUNT} queryOwnerKey="double-send" resumeActionId={ID}
    prepareMoneyAction={async () => action} resumeMoneyAction={async () => action}
    executeMoneyAction={(prepared) => {
      executions.push(prepared.id);
      return new Promise((resolve) => { finish = resolve; });
    }} onClose={() => {}} />);
  const confirm = await page().findByRole("button", { name: "Send $1.00" });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(executions).toEqual([ID]);
  expect(confirm.getAttribute("aria-busy")).toBe("true");
  await act(async () => finish({ id: ID, status: "submitted" }));
  expect(await page().findByRole("heading", { name: "$1.00 on its way" })).toBeTruthy();
});
