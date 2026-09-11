import "../account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { formatAddress } from "@/shared/formatting";
import { TransferExecutionError, type ConfirmedTransfer, type PendingTransfer } from "@/shared/transfers/types";

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
> & Partial<Pick<AccountWalletClient, "prepareMoneyAction" | "checkMoneyAction" | "executeMoneyAction" | "fetchAccountResource">>;

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
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function preparedSendAction(options: { id?: string; expiresAt?: string; ownerAddress?: `0x${string}` } = {}) {
  const recipientData = `${RECIPIENT.slice(2).padStart(64, "0")}${BigInt(100000).toString(16).padStart(64, "0")}`;
  return {
    id: options.id ?? "11111111-1111-4111-8111-111111111111",
    reviewHash: "a".repeat(64),
    owner: {
      subject: "subject-a",
      address: options.ownerAddress ?? ADDRESS,
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
    expiresAt: options.expiresAt ?? "2026-12-08T05:10:00.000Z",
  };
}

function unresolvedSendResponse(operations: unknown[] = []) {
  return { scope: "unresolved-send", operations };
}

function page() {
  return within(document.body);
}

function typeAmount(digits: string) {
  for (const digit of digits) {
    fireEvent.click(page().getByRole("button", {
      name: digit === "." ? "Decimal point" : digit,
    }));
  }
}

function composeSend(options: { asset?: "usdc" | "eth"; amount: string; recipient?: string }) {
  fireEvent.click(page().getByRole("button", { name: "Send" }));
    expect(page().getByRole("dialog", { name: "Send" })).toBeTruthy();
    expect(page().queryByRole("button", { name: "Back" })).toBeNull();
  if (options.asset === "eth") {
    fireEvent.change(page().getByLabelText("Asset"), { target: { value: "eth" } });
  }
  expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
  typeAmount(options.amount);
  fireEvent.click(page().getByRole("button", { name: "Continue" }));
  expect(page().getByRole("button", { name: "Back" })).toBeTruthy();
  fireEvent.change(page().getByLabelText("To"), {
    target: { value: options.recipient ?? RECIPIENT },
  });
  fireEvent.click(page().getByRole("button", { name: "Continue" }));
}

async function composeDurableSend(options: { asset?: "usdc" | "eth"; amount: string; recipient?: string }) {
  fireEvent.click(page().getByRole("button", { name: "Send" }));
  await page().findByRole("button", { name: "Continue" });
  if (options.asset === "eth") {
    fireEvent.change(page().getByLabelText("Asset"), { target: { value: "eth" } });
  }
  typeAmount(options.amount);
  fireEvent.click(page().getByRole("button", { name: "Continue" }));
  fireEvent.change(page().getByLabelText("To"), {
    target: { value: options.recipient ?? RECIPIENT },
  });
  await act(async () => {
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
});

describe("TransferActions modals", () => {
  test("shows a condensed Base address and reports clipboard failures", async () => {
    let copied = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => { copied = value; } },
    });
    render(<TransferActionsForWallet wallet={verifiedWallet()} />);

    fireEvent.click(page().getByRole("button", { name: "Receive" }));
    expect(page().getByRole("dialog", { name: "Receive" })).toBeTruthy();
    expect(page().getByTitle(ADDRESS).textContent).toBe(formatAddress(ADDRESS));
    expect(page().getByText("Base address")).toBeTruthy();
    expect(page().queryByText(/8453/)).toBeNull();

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

  test("walks amount → address → confirm, prevents duplicate send, and returns a compact success", async () => {
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

    composeSend({ asset: "eth", amount: "0.000000000000000001" });

    expect(page().getByRole("heading", { name: "Confirm" })).toBeTruthy();
    expect(page().getByText("0.000000000000000001 ETH")).toBeTruthy();
    expect(page().getByText("You're sending ETH")).toBeTruthy();
    expect(page().getByText("Base")).toBeTruthy();
    expect(page().queryByText(/8453/)).toBeNull();
    expect(page().queryByText(/expiresAt|base units|approval/i)).toBeNull();
    const confirm = page().getByRole("button", { name: "Send 0.000000000000000001 ETH" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(calls).toBe(1);
    expect(page().getByText(/Waiting for your wallet/)).toBeTruthy();
    expect(page().queryByText(/^Sent /)).toBeNull();

    await act(async () => {
      pending.resolve({
        assetId: "eth",
        recipient: RECIPIENT,
        amountBaseUnits: "1",
        transactionHash: HASH,
      });
      await pending.promise;
    });

    expect(page().queryByRole("dialog", { name: "Send" })).toBeNull();
    expect(page().getByText("Sent 0.000000000000000001 ETH")).toBeTruthy();
    expect(onConfirmed).toHaveLength(1);
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

    composeSend({ amount: "1.000001" });
    fireEvent.click(page().getByRole("button", { name: "Send $1.000001" }));
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
    await page().findByText("Sent $1.000001");
    expect(sends).toBe(1);
    expect(checks).toBe(1);
  });

  test("reopens an unresolved durable send as Check status recover, not a second prepare", async () => {
    const action = preparedSendAction();
    let prepares = 0;
    let checks = 0;
    let executes = 0;
    let historyPath = "";
    render(
      <TransferActionsForWallet
        wallet={{
          ...verifiedWallet(),
          prepareMoneyAction: async () => {
            prepares += 1;
            return action;
          },
          checkMoneyAction: async () => {
            checks += 1;
            return { id: action.id, status: "unknown" };
          },
          executeMoneyAction: async () => {
            executes += 1;
            throw new Error("status check must not execute");
          },
          fetchAccountResource: async (path) => {
            historyPath = path;
            return unresolvedSendResponse([{
              action,
              status: "submitting",
              attemptCount: 1,
              createdAt: action.createdAt,
              updatedAt: action.createdAt,
            }]);
          },
        }}
      />,
    );

    fireEvent.click(page().getByRole("button", { name: "Send" }));
    expect(await page().findByRole("button", { name: "Check status" })).toBeTruthy();
    expect(page().getByRole("alert").textContent).toMatch(/do not submit it again/);
    expect(page().queryByRole("button", { name: "Send $0.10" })).toBeNull();
    expect(historyPath).toBe("/api/actions/operations?scope=unresolved-send&limit=50");
    fireEvent.click(page().getByRole("button", { name: "Check status" }));
    await waitFor(() => expect(checks).toBe(1));
    expect(executes).toBe(0);
    expect(prepares).toBe(0);
  });

  test("releases durable send admission only after confirmation, then permits one fresh prepare", async () => {
    const action = preparedSendAction();
    const release = deferred<unknown>();
    let released = false;
    let releaseCalls = 0;
    let prepares = 0;
    let starts = 0;
    render(
      <TransferActionsForWallet
        wallet={{
          ...verifiedWallet(),
          startNewTransfer: () => { starts += 1; },
          fetchAccountResource: async (path, options) => {
            if (path === "/api/actions/operations?scope=unresolved-send&limit=50") {
              return released
                ? unresolvedSendResponse()
                : unresolvedSendResponse([{
                    action,
                    status: "submitting",
                    attemptCount: 1,
                    createdAt: action.createdAt,
                    updatedAt: action.createdAt,
                  }]);
            }
            if (path === `/api/actions/${action.id}/admission-release`) {
              releaseCalls += 1;
              expect(options).toMatchObject({
                method: "POST",
                body: { reason: "owner-request" },
              });
              const value = await release.promise;
              released = true;
              return value;
            }
            throw new Error(`Unexpected path: ${path}`);
          },
          prepareMoneyAction: async () => {
            prepares += 1;
            return action;
          },
          checkMoneyAction: async () => ({ id: action.id, status: "unknown" }),
          executeMoneyAction: async () => ({ id: action.id, status: "unknown" }),
        }}
      />,
    );

    fireEvent.click(page().getByRole("button", { name: "Send" }));
    await page().findByRole("button", { name: "Allow another send" });
    expect(releaseCalls).toBe(0);
    expect(prepares).toBe(0);

    fireEvent.click(page().getByRole("button", { name: "Allow another send" }));
    const releaseHeading = page().getByRole("heading", { name: "Allow another send?" });
    expect(releaseHeading).toBe(document.activeElement as HTMLElement);
    expect(releaseHeading.getAttribute("aria-describedby")).toBe("send-release-warning");
    expect(page().getByText(
      "Home will allow another send while the existing send may still submit or later confirm.",
    )).toBeTruthy();
    expect(releaseCalls).toBe(0);

    const confirmRelease = page().getByRole("button", { name: "Allow another send" });
    fireEvent.click(confirmRelease);
    fireEvent.click(confirmRelease);
    expect(releaseCalls).toBe(1);
    expect(prepares).toBe(0);
    expect(starts).toBe(0);
    expect(page().getByRole("status").textContent).toBe("Allowing another send…");
    expect((page().getByRole("button", { name: "Close send dialog" }) as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      release.resolve({
        operation: {
          action,
          status: "submitting",
          attemptCount: 1,
          abandonedAt: "2026-09-10T05:02:00.000Z",
          createdAt: action.createdAt,
          updatedAt: "2026-09-10T05:02:00.000Z",
        },
      });
      await release.promise;
    });

    expect(await page().findByText(/Home can now start another send/)).toBeTruthy();
    await page().findByRole("button", { name: "Continue" });
    expect(starts).toBe(1);
    expect(prepares).toBe(0);

    typeAmount("1");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    fireEvent.change(page().getByLabelText("To"), { target: { value: RECIPIENT } });
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(prepares).toBe(1));
  });

  test("keeps recovery and Check status available when admission release fails", async () => {
    const action = preparedSendAction();
    let releaseCalls = 0;
    let checks = 0;
    let prepares = 0;
    render(
      <TransferActionsForWallet
        wallet={{
          ...verifiedWallet(),
          fetchAccountResource: async (path) => {
            if (path === "/api/actions/operations?scope=unresolved-send&limit=50") {
              return unresolvedSendResponse([{
                action,
                status: "unknown",
                attemptCount: 1,
                createdAt: action.createdAt,
                updatedAt: action.createdAt,
              }]);
            }
            if (path === `/api/actions/${action.id}/admission-release`) {
              releaseCalls += 1;
              throw new Error("stale release");
            }
            throw new Error(`Unexpected path: ${path}`);
          },
          prepareMoneyAction: async () => {
            prepares += 1;
            return action;
          },
          checkMoneyAction: async () => {
            checks += 1;
            return { id: action.id, status: "unknown" };
          },
          executeMoneyAction: async () => ({ id: action.id, status: "unknown" }),
        }}
      />,
    );

    fireEvent.click(page().getByRole("button", { name: "Send" }));
    await page().findByRole("button", { name: "Allow another send" });
    fireEvent.click(page().getByRole("button", { name: "Allow another send" }));
    fireEvent.click(page().getByRole("button", { name: "Allow another send" }));

    expect((await page().findByRole("alert")).textContent).toMatch(/couldn’t allow another send/);
    expect(page().getByRole("button", { name: "Check status" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Allow another send" })).toBeTruthy();
    expect(releaseCalls).toBe(1);
    expect(prepares).toBe(0);

    fireEvent.click(page().getByRole("button", { name: "Check status" }));
    await waitFor(() => expect(checks).toBe(1));
    expect(prepares).toBe(0);
    expect(page().getByRole("button", { name: "Check status" })).toBeTruthy();
  });

  test("closing admission confirmation makes no release call", async () => {
    const action = preparedSendAction();
    let releaseCalls = 0;
    render(
      <TransferActionsForWallet
        wallet={{
          ...verifiedWallet(),
          fetchAccountResource: async (path) => {
            if (path === "/api/actions/operations?scope=unresolved-send&limit=50") {
              return unresolvedSendResponse([{
                action,
                status: "submitting",
                attemptCount: 1,
                createdAt: action.createdAt,
                updatedAt: action.createdAt,
              }]);
            }
            releaseCalls += 1;
            throw new Error(`Unexpected release path: ${path}`);
          },
          prepareMoneyAction: async () => action,
          checkMoneyAction: async () => ({ id: action.id, status: "unknown" }),
          executeMoneyAction: async () => ({ id: action.id, status: "unknown" }),
        }}
      />,
    );

    fireEvent.click(page().getByRole("button", { name: "Send" }));
    await page().findByRole("button", { name: "Allow another send" });
    fireEvent.click(page().getByRole("button", { name: "Allow another send" }));
    expect(page().getByRole("dialog", { name: "Confirm" })).toBeTruthy();
    expect(page().getByRole("heading", { name: "Allow another send?" })).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Close send dialog" }));
    expect(page().queryByRole("dialog", { name: "Confirm" })).toBeNull();
    expect(page().queryByRole("heading", { name: "Allow another send?" })).toBeNull();
    expect(releaseCalls).toBe(0);
  });

  test("keeps reopened same-owner recovery fenced from an older dismissed release", async () => {
    const action = preparedSendAction();
    const release = deferred<unknown>();
    let releaseCalls = 0;
    let starts = 0;
    render(
      <TransferActionsForWallet
        wallet={{
          ...verifiedWallet(),
          startNewTransfer: () => { starts += 1; },
          fetchAccountResource: async (path) => {
            if (path === "/api/actions/operations?scope=unresolved-send&limit=50") {
              return unresolvedSendResponse([{
                action,
                status: "submitted",
                attemptCount: 1,
                createdAt: action.createdAt,
                updatedAt: action.createdAt,
              }]);
            }
            if (path === `/api/actions/${action.id}/admission-release`) {
              releaseCalls += 1;
              return release.promise;
            }
            throw new Error(`Unexpected path: ${path}`);
          },
          prepareMoneyAction: async () => action,
          checkMoneyAction: async () => ({ id: action.id, status: "submitted" }),
          executeMoneyAction: async () => ({ id: action.id, status: "submitted" }),
        }}
      />,
    );

    fireEvent.click(page().getByRole("button", { name: "Send" }));
    await page().findByRole("button", { name: "Allow another send" });
    fireEvent.click(page().getByRole("button", { name: "Allow another send" }));
    const confirmDialog = page().getByRole("dialog", { name: "Confirm" });
    expect(page().getByRole("heading", { name: "Allow another send?" })).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Allow another send" }));
    expect(releaseCalls).toBe(1);

    const grabber = confirmDialog.querySelector("[data-money-sheet-grabber]");
    expect(grabber).toBeTruthy();
    await act(async () => {
      fireEvent.pointerDown(grabber!, { pointerId: 1, button: 0, clientY: 40 });
      fireEvent.pointerMove(grabber!, { pointerId: 1, clientY: 120 });
      fireEvent.pointerUp(grabber!, { pointerId: 1, clientY: 120 });
    });

    await waitFor(() => expect(page().queryByRole("dialog", { name: "Confirm" })).toBeNull());
    expect(page().queryByRole("heading", { name: "Allow another send?" })).toBeNull();
    await waitFor(() => expect((confirmDialog as HTMLDialogElement).open).toBe(false));
    expect(releaseCalls).toBe(1);
    expect(starts).toBe(0);

    fireEvent.click(page().getByRole("button", { name: "Send" }));
    expect(await page().findByRole("dialog", { name: "Confirm" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Check status" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Allow another send" })).toBeTruthy();

    await act(async () => {
      release.resolve({
        operation: {
          action,
          status: "submitted",
          attemptCount: 1,
          abandonedAt: "2026-09-10T05:02:00.000Z",
          createdAt: action.createdAt,
          updatedAt: "2026-09-10T05:02:00.000Z",
        },
      });
      await release.promise;
      await Promise.resolve();
    });

    expect(page().getByRole("dialog", { name: "Confirm" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Check status" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Allow another send" })).toBeTruthy();
    expect(page().queryByRole("button", { name: "Continue" })).toBeNull();
    expect(releaseCalls).toBe(1);
    expect(starts).toBe(0);
  });

  test("ignores an old owner's release response without unlocking the next owner's recovery", async () => {
    const oldAction = preparedSendAction();
    const oldRelease = deferred<unknown>();
    const nextAddress = "0x3333333333333333333333333333333333333333" as const;
    const nextAction = preparedSendAction({
      id: "22222222-2222-4222-8222-222222222222",
      ownerAddress: nextAddress,
    });
    let starts = 0;
    let prepares = 0;
    const view = render(
      <TransferActionsForWallet
        wallet={{
          ...verifiedWallet(),
          startNewTransfer: () => { starts += 1; },
          fetchAccountResource: async (path) => {
            if (path === "/api/actions/operations?scope=unresolved-send&limit=50") {
              return unresolvedSendResponse([{
                action: oldAction,
                status: "submitting",
                attemptCount: 1,
                createdAt: oldAction.createdAt,
                updatedAt: oldAction.createdAt,
              }]);
            }
            if (path === `/api/actions/${oldAction.id}/admission-release`) return oldRelease.promise;
            throw new Error(`Unexpected path: ${path}`);
          },
          prepareMoneyAction: async () => oldAction,
          checkMoneyAction: async () => ({ id: oldAction.id, status: "unknown" }),
          executeMoneyAction: async () => ({ id: oldAction.id, status: "unknown" }),
        }}
      />,
    );

    fireEvent.click(page().getByRole("button", { name: "Send" }));
    await page().findByRole("button", { name: "Allow another send" });
    fireEvent.click(page().getByRole("button", { name: "Allow another send" }));
    fireEvent.click(page().getByRole("button", { name: "Allow another send" }));
    expect(page().getByRole("dialog", { name: "Confirm" })).toBeTruthy();
    expect(page().getByRole("heading", { name: "Allow another send?" })).toBeTruthy();
    expect(page().getByRole("status").textContent).toBe("Allowing another send…");

    view.rerender(
      <TransferActionsForWallet
        wallet={{
          ...verifiedWallet(),
          ownerKey: "owner-b",
          session: {
            user: { subject: "subject-b" },
            smartAccount: { address: nextAddress, chainId: 8453 },
            accountProvider: "cdp-embedded",
          },
          startNewTransfer: () => { starts += 1; },
          fetchAccountResource: async (path) => {
            if (path === "/api/actions/operations?scope=unresolved-send&limit=50") {
              return unresolvedSendResponse([{
                action: nextAction,
                status: "unknown",
                attemptCount: 1,
                createdAt: nextAction.createdAt,
                updatedAt: nextAction.createdAt,
              }]);
            }
            throw new Error(`Unexpected path: ${path}`);
          },
          prepareMoneyAction: async () => {
            prepares += 1;
            return nextAction;
          },
          checkMoneyAction: async () => ({ id: nextAction.id, status: "unknown" }),
          executeMoneyAction: async () => ({ id: nextAction.id, status: "unknown" }),
        }}
      />,
    );

    expect(page().queryByRole("dialog", { name: "Confirm" })).toBeNull();
    expect(page().queryByRole("heading", { name: "Allow another send?" })).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Send" }));
    await page().findByRole("button", { name: "Check status" });

    await act(async () => {
      oldRelease.resolve({
        operation: {
          action: oldAction,
          status: "submitting",
          attemptCount: 1,
          abandonedAt: "2026-09-10T05:02:00.000Z",
          createdAt: oldAction.createdAt,
          updatedAt: "2026-09-10T05:02:00.000Z",
        },
      });
      await oldRelease.promise;
    });

    expect(page().getByRole("button", { name: "Check status" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Allow another send" })).toBeTruthy();
    expect(page().queryByRole("button", { name: "Continue" })).toBeNull();
    expect(starts).toBe(0);
    expect(prepares).toBe(0);
  });

  test("keeps release off a prepared send through expiry and a prepared status check", async () => {
    const originalNow = Date.now;
    let now = Date.parse("2026-09-10T12:00:00.000Z");
    Date.now = () => now;
    try {
      const action = preparedSendAction({ expiresAt: "2026-09-10T12:00:01.000Z" });
      let checks = 0;
      let executions = 0;
      let releaseCalls = 0;
      render(
        <TransferActionsForWallet
          wallet={{
            ...verifiedWallet(),
            fetchAccountResource: async (path) => {
              if (path === "/api/actions/operations?scope=unresolved-send&limit=50") {
                return unresolvedSendResponse();
              }
              if (path === `/api/actions/${action.id}/admission-release`) {
                releaseCalls += 1;
                throw new Error("prepared action must not release admission");
              }
              throw new Error(`Unexpected path: ${path}`);
            },
            prepareMoneyAction: async () => action,
            checkMoneyAction: async () => {
              checks += 1;
              return { id: action.id, status: "prepared" };
            },
            executeMoneyAction: async () => {
              executions += 1;
              return { id: action.id, status: "unknown" };
            },
          }}
        />,
      );

      await composeDurableSend({ amount: "0.1" });
      expect(await page().findByRole("button", { name: "Send $0.10" })).toBeTruthy();
      expect(page().getByRole("dialog", { name: "Confirm" })).toBeTruthy();
      expect(page().queryByRole("button", { name: "Allow another send" })).toBeNull();

      now = Date.parse("2026-09-10T12:00:02.000Z");
      fireEvent.click(page().getByRole("button", { name: "Send $0.10" }));
      expect(await page().findByRole("button", { name: "Check send status" })).toBeTruthy();
      expect(executions).toBe(0);
      expect(releaseCalls).toBe(0);

      fireEvent.click(page().getByRole("button", { name: "Check send status" }));
      await waitFor(() => expect(checks).toBe(1));
      expect(page().getByRole("button", { name: "Check status" })).toBeTruthy();
      expect(page().queryByRole("button", { name: "Allow another send" })).toBeNull();
      expect(releaseCalls).toBe(0);
      expect(executions).toBe(0);
    } finally {
      Date.now = originalNow;
    }
  });

  test("blocks a fresh durable send while history is pending even if Continue is raced", async () => {
    const history = deferred<unknown>();
    const action = preparedSendAction();
    let prepares = 0;
    render(
      <TransferActionsForWallet
        wallet={{
          ...verifiedWallet(),
          fetchAccountResource: async () => history.promise,
          prepareMoneyAction: async () => {
            prepares += 1;
            return action;
          },
          executeMoneyAction: async () => ({ id: action.id, status: "unknown" }),
        }}
      />,
    );

    fireEvent.click(page().getByRole("button", { name: "Send" }));
    typeAmount("1");
    const checking = page().getByRole("button", { name: "Checking recent sends…" }) as HTMLButtonElement;
    expect(checking.disabled).toBe(true);
    fireEvent.click(checking);
    expect(prepares).toBe(0);

    await act(async () => {
      history.resolve(unresolvedSendResponse());
      await history.promise;
    });
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    fireEvent.change(page().getByLabelText("To"), { target: { value: RECIPIENT } });
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(prepares).toBe(1));
  });

  test("fails closed on rejected history and allows an explicit retry", async () => {
    const firstHistory = deferred<unknown>();
    let historyCalls = 0;
    const action = preparedSendAction();
    render(
      <TransferActionsForWallet
        wallet={{
          ...verifiedWallet(),
          fetchAccountResource: async () => {
            historyCalls += 1;
            if (historyCalls === 1) return firstHistory.promise;
            return unresolvedSendResponse();
          },
          prepareMoneyAction: async () => action,
          executeMoneyAction: async () => ({ id: action.id, status: "unknown" }),
        }}
      />,
    );

    fireEvent.click(page().getByRole("button", { name: "Send" }));
    await act(async () => {
      firstHistory.reject(new Error("history unavailable"));
      try { await firstHistory.promise; } catch {}
    });
    expect(page().getByRole("alert").textContent).toMatch(/couldn’t be checked/);
    expect(page().queryByRole("button", { name: "Continue" })).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Retry recent sends" }));
    await page().findByRole("button", { name: "Continue" });
    expect(historyCalls).toBe(2);
  });

  test("does not fall back to the legacy sender when durable prepare exists without history", async () => {
    const action = preparedSendAction();
    let prepares = 0;
    let legacySends = 0;
    render(
      <TransferActionsForWallet
        wallet={{
          ...verifiedWallet(async (request) => {
            legacySends += 1;
            return { ...request, transactionHash: HASH };
          }),
          prepareMoneyAction: async () => {
            prepares += 1;
            return action;
          },
          executeMoneyAction: async () => ({ id: action.id, status: "unknown" }),
        }}
      />,
    );

    fireEvent.click(page().getByRole("button", { name: "Send" }));
    expect(page().getByRole("alert").textContent).toMatch(/couldn’t be checked/);
    expect(page().getByRole("button", { name: "Retry recent sends" })).toBeTruthy();
    expect(prepares).toBe(0);
    expect(legacySends).toBe(0);
  });

  test("fails closed when recent-operation history is malformed", async () => {
    const action = preparedSendAction();
    render(
      <TransferActionsForWallet
        wallet={{
          ...verifiedWallet(),
          fetchAccountResource: async () => unresolvedSendResponse([{ status: "submitting", action: null }]),
          prepareMoneyAction: async () => action,
          executeMoneyAction: async () => ({ id: action.id, status: "unknown" }),
        }}
      />,
    );

    fireEvent.click(page().getByRole("button", { name: "Send" }));
    expect((await page().findByRole("alert")).textContent).toMatch(/invalid response/);
    expect(page().getByRole("button", { name: "Retry recent sends" })).toBeTruthy();
    expect(page().queryByRole("button", { name: "Continue" })).toBeNull();
  });

  test("does not accept generic recent history as complete send-recovery evidence", async () => {
    const action = preparedSendAction();
    let prepares = 0;
    render(
      <TransferActionsForWallet
        wallet={{
          ...verifiedWallet(),
          fetchAccountResource: async () => ({ operations: [] }),
          prepareMoneyAction: async () => {
            prepares += 1;
            return action;
          },
          executeMoneyAction: async () => ({ id: action.id, status: "unknown" }),
        }}
      />,
    );

    fireEvent.click(page().getByRole("button", { name: "Send" }));
    expect((await page().findByRole("alert")).textContent).toMatch(/invalid response/);
    expect(page().getByRole("button", { name: "Retry recent sends" })).toBeTruthy();
    expect(prepares).toBe(0);
  });

  test("does not let an old owner's deferred history reopen recovery after the owner changes", async () => {
    const oldHistory = deferred<unknown>();
    const oldAction = preparedSendAction();
    const nextAddress = "0x3333333333333333333333333333333333333333" as const;
    const view = render(
      <TransferActionsForWallet
        wallet={{
          ...verifiedWallet(),
          fetchAccountResource: async () => oldHistory.promise,
          prepareMoneyAction: async () => oldAction,
          executeMoneyAction: async () => ({ id: oldAction.id, status: "unknown" }),
        }}
      />,
    );
    fireEvent.click(page().getByRole("button", { name: "Send" }));
    expect(page().getByRole("status").textContent).toBe("Checking recent sends…");

    const nextAction = preparedSendAction({ ownerAddress: nextAddress });
    view.rerender(
      <TransferActionsForWallet
        wallet={{
          ...verifiedWallet(),
          ownerKey: "owner-b",
          session: {
            user: { subject: "subject-b" },
            smartAccount: { address: nextAddress, chainId: 8453 },
            accountProvider: "cdp-embedded",
          },
          fetchAccountResource: async () => unresolvedSendResponse(),
          prepareMoneyAction: async () => nextAction,
          executeMoneyAction: async () => ({ id: nextAction.id, status: "unknown" }),
        }}
      />,
    );
    expect(page().queryByRole("dialog", { name: "Send" })).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Send" }));
    await page().findByRole("button", { name: "Continue" });

    await act(async () => {
      oldHistory.resolve(unresolvedSendResponse([{ action: oldAction, status: "submitting" }]));
      await oldHistory.promise;
    });
    expect(page().queryByRole("button", { name: "Check status" })).toBeNull();
    expect(page().getByRole("button", { name: "Continue" })).toBeTruthy();
  });

  test("reports preparation failure without claiming the wallet was opened", async () => {
    const action = preparedSendAction();
    let walletExecutions = 0;
    render(
      <TransferActionsForWallet
        wallet={{
          ...verifiedWallet(),
          fetchAccountResource: async () => unresolvedSendResponse(),
          prepareMoneyAction: async () => { throw new Error("server unavailable"); },
          executeMoneyAction: async () => {
            walletExecutions += 1;
            return { id: action.id, status: "unknown" };
          },
        }}
      />,
    );

    await composeDurableSend({ amount: "1" });
    expect((await page().findByRole("alert")).textContent).toMatch(/couldn’t prepare.*wallet was not asked/i);
    expect(page().getByLabelText("To")).toBeTruthy();
    expect(walletExecutions).toBe(0);
  });

  test("rechecks prepared expiry synchronously before dispatch", async () => {
    const originalNow = Date.now;
    let now = Date.parse("2026-09-09T12:00:00.000Z");
    Date.now = () => now;
    try {
      const action = preparedSendAction({ expiresAt: "2026-09-09T12:00:01.000Z" });
      let executions = 0;
      render(
        <TransferActionsForWallet
          wallet={{
            ...verifiedWallet(),
            fetchAccountResource: async () => unresolvedSendResponse(),
            prepareMoneyAction: async () => action,
            executeMoneyAction: async () => {
              executions += 1;
              return { id: action.id, status: "unknown" };
            },
          }}
        />,
      );

      await composeDurableSend({ amount: "0.1" });
      await page().findByRole("button", { name: "Send $0.10" });
      now = Date.parse("2026-09-09T12:00:02.000Z");
      fireEvent.click(page().getByRole("button", { name: "Send $0.10" }));
      expect(executions).toBe(0);
      expect(page().getByRole("button", { name: "Check send status" })).toBeTruthy();
      expect(page().getAllByRole("alert").some((alert) => /expired/.test(alert.textContent ?? ""))).toBe(true);
    } finally {
      Date.now = originalNow;
    }
  });

  test("closes Send from step 1 with × and keeps Back off that step", () => {
    render(<TransferActionsForWallet wallet={verifiedWallet()} />);
    fireEvent.click(page().getByRole("button", { name: "Send" }));
    expect(page().queryByRole("button", { name: "Back" })).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Close send dialog" }));
    expect(page().queryByRole("dialog", { name: "Send" })).toBeNull();
  });

  test("hides an open private modal immediately when the verified owner changes", () => {
    const view = render(<TransferActionsForWallet wallet={verifiedWallet()} />);
    fireEvent.click(page().getByRole("button", { name: "Receive" }));
    expect(page().getByTitle(ADDRESS)).toBeTruthy();

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

    expect(page().queryByTitle(ADDRESS)).toBeNull();
    expect(page().getByRole("button", { name: "Receive" }).hasAttribute("disabled")).toBe(true);
  });

  test("drops Send compose content in the account-boundary close frame", async () => {
    const view = render(<TransferActionsForWallet wallet={verifiedWallet()} />);
    fireEvent.click(page().getByRole("button", { name: "Send" }));
    await page().findByRole("button", { name: "Continue" });
    typeAmount("13");
    expect(document.querySelector("[data-primary-amount]")?.textContent).toBe("$13");

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

    expect(document.querySelector("[data-primary-amount]")).toBeNull();
    expect(page().queryByRole("dialog", { name: "Send" })).toBeNull();
  });
});
