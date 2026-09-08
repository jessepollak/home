import "../account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import type { AccountWalletClient } from "@/features/account/cdp-client";
import { TransferExecutionError, type ConfirmedTransfer, type PendingTransfer } from "./types";

const { act, cleanup, fireEvent, render, waitFor, within } = await import(
  "@testing-library/react"
);
const { TransferActionsForWallet } = await import("./transfer-actions");

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const RECIPIENT = "0x2222222222222222222222222222222222222222" as const;
const HASH = `0x${"ab".repeat(32)}` as const;

type TransferWallet = Pick<
  AccountWalletClient,
  | "ownerKey"
  | "status"
  | "session"
  | "pendingTransfer"
  | "sendTransfer"
  | "checkPendingTransfer"
  | "startNewTransfer"
>;

function verifiedWallet(
  sendTransfer: TransferWallet["sendTransfer"] = async (request) => ({
    ...request,
    transactionHash: HASH,
  }),
): TransferWallet {
  return {
    ownerKey: "owner-a",
    status: "verified",
    session: {
      user: { subject: "subject-a" },
      smartAccount: { address: ADDRESS, chainId: 8453 },
      accountProvider: "cdp-embedded",
    },
    pendingTransfer: null,
    sendTransfer,
    checkPendingTransfer: async () => {
      throw new Error("No pending transfer");
    },
    startNewTransfer: () => {},
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function page() {
  return within(document.body);
}

afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
});

describe("TransferActions modals", () => {
  test("shows only the verified Base address and reports clipboard failures", async () => {
    let copied = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => { copied = value; } },
    });
    render(<TransferActionsForWallet wallet={verifiedWallet()} />);

    fireEvent.click(page().getByRole("button", { name: "Receive" }));
    expect(page().getByRole("dialog", { name: "Receive" })).toBeTruthy();
    expect(page().getByText(ADDRESS)).toBeTruthy();
    expect(page().getByText(/Base \(chain 8453\)/)).toBeTruthy();

    fireEvent.click(page().getByRole("button", { name: "Copy address" }));
    await waitFor(() => expect(copied).toBe(ADDRESS));
    expect(page().getByRole("button", { name: "Copied" })).toBeTruthy();

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => { throw new Error("denied"); } },
    });
    fireEvent.click(page().getByRole("button", { name: "Copied" }));
    await waitFor(() =>
      expect(page().getByRole("alert").textContent).toContain("Clipboard access failed"),
    );
  });

  test("requires explicit review, prevents duplicate confirmation, and waits for confirmed result", async () => {
    const pending = deferred<ConfirmedTransfer>();
    let calls = 0;
    const onConfirmed: ConfirmedTransfer[] = [];
    render(
      <TransferActionsForWallet
        wallet={verifiedWallet(async () => {
          calls += 1;
          return pending.promise;
        })}
        onTransferConfirmed={(transfer) => onConfirmed.push(transfer)}
      />,
    );

    fireEvent.click(page().getByRole("button", { name: "Send" }));
    fireEvent.change(page().getByLabelText("Recipient address"), {
      target: { value: RECIPIENT },
    });
    fireEvent.change(page().getByLabelText("Asset"), {
      target: { value: "eth" },
    });
    fireEvent.change(page().getByLabelText("Amount"), {
      target: { value: "0.000000000000000001" },
    });
    fireEvent.click(page().getByRole("button", { name: "Review transfer" }));

    expect(page().getByRole("heading", { name: "Review transfer" })).toBeTruthy();
    expect(page().getByText("0.000000000000000001 ETH")).toBeTruthy();
    const confirm = page().getByRole("button", { name: "Confirm and send" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(calls).toBe(1);
    expect(page().getByText(/Waiting for your wallet/)).toBeTruthy();
    expect(page().queryByText("Transfer confirmed")).toBeNull();

    await act(async () => {
      pending.resolve({
        assetId: "eth",
        recipient: RECIPIENT,
        amountBaseUnits: "1",
        transactionHash: HASH,
      });
      await pending.promise;
    });

    expect(page().getByRole("heading", { name: "Transfer confirmed" })).toBeTruthy();
    expect(onConfirmed).toHaveLength(1);
    expect(page().getByText("<0.000001 ETH sent on Base.")).toBeTruthy();
    expect(onConfirmed[0]?.transactionHash).toBe(HASH);
    expect(onConfirmed[0]?.amountBaseUnits).toBe("1");
  });

  test("reopens an existing timed-out submission and checks it without sending again", async () => {
    let sends = 0;
    let checks = 0;
    const pending: PendingTransfer = {
      assetId: "usdc",
      recipient: RECIPIENT,
      amountBaseUnits: "1000001",
      intentId: "123e4567-e89b-42d3-a456-426614174000",
      provider: "cdp-embedded",
      state: "submitted",
      userOperationHash: `0x${"cd".repeat(32)}`,
    };
    const wallet = verifiedWallet(async () => {
      sends += 1;
      throw new TransferExecutionError("confirmation-timeout");
    });
    const view = render(<TransferActionsForWallet wallet={wallet} />);

    fireEvent.click(page().getByRole("button", { name: "Send" }));
    fireEvent.change(page().getByLabelText("Recipient address"), {
      target: { value: RECIPIENT },
    });
    fireEvent.change(page().getByLabelText("Amount"), {
      target: { value: "1.000001" },
    });
    fireEvent.click(page().getByRole("button", { name: "Review transfer" }));
    fireEvent.click(page().getByRole("button", { name: "Confirm and send" }));
    await page().findByRole("button", { name: "Check existing submission" });

    view.rerender(
      <TransferActionsForWallet
        wallet={{
          ...wallet,
          pendingTransfer: pending,
          checkPendingTransfer: async () => {
            checks += 1;
            return { ...pending, transactionHash: HASH };
          },
        }}
      />,
    );
    fireEvent.click(page().getByRole("button", { name: "Close safely" }));
    fireEvent.click(page().getByRole("button", { name: "Send" }));
    expect(page().getByText(/already submitted/)).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Check existing submission" }));
    await page().findByRole("heading", { name: "Transfer confirmed" });
    expect(sends).toBe(1);
    expect(checks).toBe(1);
  });

  test("reopens an unresolved durable send as Check status recover, not a second prepare", async () => {
    const recipientData = `${RECIPIENT.slice(2).padStart(64, "0")}${BigInt(100000).toString(16).padStart(64, "0")}`;
    const action = {
      id: "11111111-1111-4111-8111-111111111111",
      reviewHash: "a".repeat(64),
      owner: {
        subject: "subject-a",
        address: ADDRESS,
        chainId: 8453 as const,
        accountProvider: "cdp-embedded" as const,
      },
      kind: "send" as const,
      title: "Send USDC",
      calls: [{
        to: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const,
        data: `0xa9059cbb${recipientData}` as `0x${string}`,
        value: "0",
      }],
      amounts: [{
        assetId: "usdc" as const,
        symbol: "USDC",
        decimals: 6,
        amountBaseUnits: "100000",
        direction: "spend" as const,
      }],
      warnings: ["Network fee shown by wallet."],
      createdAt: "2026-09-08T05:00:00.000Z",
      expiresAt: "2026-12-08T05:10:00.000Z",
    };
    let prepares = 0;
    let executes = 0;
    render(
      <TransferActionsForWallet
        wallet={{
          ...verifiedWallet(),
          prepareMoneyAction: async () => {
            prepares += 1;
            return action;
          },
          executeMoneyAction: async () => {
            executes += 1;
            return { id: action.id, status: "unknown" };
          },
          fetchOperations: async () => ({
            operations: [{
              action,
              status: "submitting",
              attemptCount: 1,
              createdAt: action.createdAt,
              updatedAt: action.createdAt,
            }],
          }),
        }}
      />,
    );

    fireEvent.click(page().getByRole("button", { name: "Send" }));
    expect(await page().findByRole("button", { name: "Check status" })).toBeTruthy();
    expect(page().getByRole("alert").textContent).toMatch(/do not submit it again/);
    expect(page().queryByRole("button", { name: "Confirm action" })).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Check status" }));
    await waitFor(() => expect(executes).toBe(1));
    expect(prepares).toBe(0);
  });

  test("hides an open private modal immediately when the verified owner changes", () => {
    const view = render(<TransferActionsForWallet wallet={verifiedWallet()} />);
    fireEvent.click(page().getByRole("button", { name: "Receive" }));
    expect(page().getByText(ADDRESS)).toBeTruthy();

    view.rerender(
      <TransferActionsForWallet
        wallet={{
          ...verifiedWallet(),
          ownerKey: "owner-b",
          status: "validating",
          session: null,
        }}
      />,
    );

    expect(page().queryByText(ADDRESS)).toBeNull();
    expect(page().getByRole("button", { name: "Receive" }).hasAttribute("disabled")).toBe(true);
  });
});
