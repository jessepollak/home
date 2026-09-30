import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { afterEach, expect, test } from "bun:test";
import type { ComponentProps } from "react";
import { getTransferAsset } from "@/shared/transfers/transfer-helpers";

const { act, fireEvent, render, waitFor } = await import("@testing-library/react");
const { TransferActionsForWallet } = await import("./transfer-actions");

type Wallet = ComponentProps<typeof TransferActionsForWallet>["wallet"];
const ADDRESS_A = "0x1111111111111111111111111111111111111111" as const;
const ADDRESS_B = "0x3333333333333333333333333333333333333333" as const;
const RECIPIENT_A = "0x2222222222222222222222222222222222222222";
const assets = [{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" }];

function wallet(subject: string, address: `0x${string}`): Wallet {
  return {
    ownerKey: `wallet-${subject}`,
    status: "verified",
    verification: "server",
    session: { user: { subject }, smartAccount: { address, chainId: 8453 }, accountProvider: "cdp-embedded" },
    fetchAccountResource: async (path) => {
      if (path === "/api/actions/network-fee") return { version: 1, usdcReserveBaseUnits: "20000" };
      if (path === "/api/transfers/recent-recipients") return { version: 1, recipients: [] };
      if (path.startsWith("/api/funding/providers")) return { version: 2, direction: "offramp", providers: [] };
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
  window.requestAnimationFrame = originalRequestFrame;
  window.cancelAnimationFrame = originalCancelFrame;
  window.history.replaceState(null, "", "/");
});

test("changing Send owner drops the sheet immediately and reopens without the previous draft", async () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  window.requestAnimationFrame = (callback) => { const id = ++nextFrame; frames.set(id, callback); return id; };
  window.cancelAnimationFrame = (id) => { frames.delete(id); };
  async function flushFrame() {
    await act(async () => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(performance.now()));
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
  const reopened = await page().findByRole("dialog", { name: "Send" });
  expect((page().getByRole("textbox", { name: "Amount" }) as HTMLInputElement).value).toBe("");
  expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
  expect(reopened.textContent).not.toContain(RECIPIENT_A);
  fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "2" } });
  fireEvent.click(page().getByRole("button", { name: "Continue" }));
  expect((page().getByRole("textbox", { name: "To" }) as HTMLInputElement).value).toBe("");
});
