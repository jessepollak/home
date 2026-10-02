import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { afterEach, expect, test } from "bun:test";
import type { ComponentProps } from "react";
import { encodeUsdcTransfer, getTransferAsset } from "@/shared/transfers/transfer-helpers";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { FUNDING_PROVIDERS_VERSION } from "@/shared/funding/contracts/providers";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { getHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import { applyActionHandleEffects } from "@/client/query/after-action";

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { TransferActionsForWallet } = await import("./transfer-actions");

type Wallet = ComponentProps<typeof TransferActionsForWallet>["wallet"];
const ADDRESS_A = "0x1111111111111111111111111111111111111111" as const;
const ADDRESS_B = "0x3333333333333333333333333333333333333333" as const;
const RECIPIENT_A: `0x${string}` = "0x2222222222222222222222222222222222222222";
const assets = [{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" }];

function wallet(subject: string, address: `0x${string}`, reads?: string[]): Wallet & { session: NonNullable<Wallet["session"]> } {
  return {
    ownerKey: `wallet-${subject}`,
    status: "verified",
    verification: "server",
    session: { user: { subject }, smartAccount: { address, chainId: 8453 }, accountProvider: "cdp-embedded" },
    fetchAccountResource: async (path) => {
      reads?.push(path);
      if (path === "/api/actions/network-fee") return { version: 1, usdcReserveBaseUnits: "20000" };
      if (path === "/api/transfers/recent-recipients") return { version: 1, recipients: [] };
      if (path.startsWith("/api/funding/providers")) return { version: FUNDING_PROVIDERS_VERSION, direction: "offramp", providers: [] };
      throw new Error(`Unexpected account resource: ${path}`);
    },
    prepareMoneyAction: async () => { throw new Error("Unexpected prepare"); },
    resumeMoneyAction: async () => { throw new Error("Unexpected resume"); },
    executeMoneyAction: async () => { throw new Error("Unexpected execute"); },
  };
}

const originalRequestFrame = window.requestAnimationFrame;
const originalCancelFrame = window.cancelAnimationFrame;

afterEach(() => {
  cleanup();
  window.requestAnimationFrame = originalRequestFrame;
  window.cancelAnimationFrame = originalCancelFrame;
  window.history.replaceState(null, "", "/");
});

test("changing Send owner drops the sheet immediately and reopens without the previous draft", async () => {
  (globalThis as { BASE_UI_ANIMATIONS_DISABLED?: boolean }).BASE_UI_ANIMATIONS_DISABLED = false;
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  window.requestAnimationFrame = (callback) => { const id = ++nextFrame; frames.set(id, callback); return id; };
  window.cancelAnimationFrame = (id) => { frames.delete(id); };
  async function flushFrame() {
    await act(async () => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(100_000));
      await Promise.resolve();
    });
  }

  const view = render(<TransferActionsForWallet wallet={wallet("owner-a", ADDRESS_A)} availableAssets={assets} />);
  fireEvent.click(page().getByRole("button", { name: "Send" }));
  await waitFor(() => expect(frames.size).toBeGreaterThan(0));
  await flushFrame();
  await page().findByRole("dialog", { name: "Send" });
  await flushFrame();

  fireEvent.input(await page().findByRole("textbox", { name: "Amount" }), { target: { value: "1.25" } });
  fireEvent.click(page().getByRole("button", { name: "Continue" }));
  const recipient = page().getByRole("textbox", { name: "To" });
  fireEvent.focus(recipient);
  fireEvent.change(recipient, { target: { value: RECIPIENT_A } });
  expect((recipient as HTMLInputElement).value).toBe(RECIPIENT_A);

  view.rerender(<TransferActionsForWallet wallet={wallet("owner-b", ADDRESS_B)} availableAssets={assets} />);
  expect(document.querySelector("[data-money-sheet]")?.hasAttribute("data-immediate")).toBe(true);
  await flushFrame();
  await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
  expect(page().queryByRole("textbox", { name: "To" })).toBeNull();

  fireEvent.click(page().getByRole("button", { name: "Send" }));
  await flushFrame();
  await page().findByRole("textbox", { name: "Amount" });
  const reopened = await page().findByRole("dialog", { name: "Send" });
  expect((page().getByRole("textbox", { name: "Amount" }) as HTMLInputElement).value).toBe("");
  expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
  expect(reopened.textContent).not.toContain(RECIPIENT_A);
  fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "2" } });
  fireEvent.click(page().getByRole("button", { name: "Continue" }));
  expect((page().getByRole("textbox", { name: "To" }) as HTMLInputElement).value).toBe("");
});

test("paused Send still mounts a routed review for an existing send action", async () => {
  const actionId = "11111111-1111-4111-8111-111111111111";
  const action: PreparedMoneyAction = {
    id: actionId, kind: "send", title: "Send USDC", createdAt: "2026-09-12T12:00:00.000Z", expiresAt: "2099-09-12T12:10:00.000Z",
    calls: [{ to: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", data: encodeUsdcTransfer(RECIPIENT_A, BigInt(1_000_000)), value: "0" }],
    amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "spend" }],
    warnings: [],
    owner: { subject: "owner-a", address: ADDRESS_A, chainId: 8453, accountProvider: "cdp-embedded" },
  };
  const account: Wallet = { ...wallet("owner-a", ADDRESS_A), resumeMoneyAction: async (id) => {
    expect(id).toBe(actionId);
    return action;
  } };
  render(<TransferActionsForWallet wallet={account} availableAssets={assets} sendOffered={false} initialOpen initialActionId={actionId} />);
  const trigger = page().getByRole("button", { name: "Cash out" });
  expect(trigger.hasAttribute("data-action-trigger")).toBe(true);
  fireEvent.focus(trigger);
  expect(await page().findByRole("dialog", { name: "Confirm" })).toBeTruthy();
  expect(page().getByRole("button", { name: "Send $1.00" }).getAttribute("data-money-action-id")).toBe(actionId);
});

test("paused Send opens the cash-out dialog from its trigger", async () => {
  render(<TransferActionsForWallet wallet={wallet("owner-a", ADDRESS_A)} availableAssets={assets} sendOffered={false} />);
  fireEvent.click(page().getByRole("button", { name: "Cash out" }));
  const dialog = await page().findByRole("dialog", { name: "Cash out" });
  expect(dialog).toBeTruthy();
});

test("keys the send dialog's recipient reads by the data owner so a post-action refetch reaches them", async () => {
  const reads: string[] = [];
  const owner = dataOwnerKey(wallet("owner-a", ADDRESS_A).session);
  render(<TransferActionsForWallet wallet={wallet("owner-a", ADDRESS_A, reads)} availableAssets={assets} />);
  fireEvent.click(page().getByRole("button", { name: "Send" }));
  await page().findByRole("dialog", { name: "Send" });
  const recentReads = () => reads.filter((path) => path === "/api/transfers/recent-recipients").length;
  await waitFor(() => expect(recentReads()).toBe(1));
  expect(getHomeQueryClient().getQueryState(ownerQueryKey(owner, "transfers-recent-recipients"))?.status).toBe("success");

  await act(async () => {
    await applyActionHandleEffects({
      path: "/api/actions/action-123/handle",
      body: { transactionHash: "0x1234" },
      dataOwnerKey: owner,
      queryClient: getHomeQueryClient(),
      startBalanceFreshness: () => {},
    });
  });

  await waitFor(() => expect(recentReads()).toBe(2));
});
