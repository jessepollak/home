import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { afterEach, describe, expect, test } from "bun:test";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { encodeUsdcTransfer, getTransferAsset } from "@/shared/transfers/transfer-helpers";
import { TransferExecutionError } from "@/shared/transfers/types";

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { SendDialog } = await import("./send-dialog");

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const RECIPIENT = "0x2222222222222222222222222222222222222222" as const;
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const ACTION_ID = "11111111-1111-4111-8111-111111111111";

function resumedAction(kind: PreparedMoneyAction["kind"] = "send"): PreparedMoneyAction {
  return {
    id: ACTION_ID,
    kind,
    title: "Send USDC",
    createdAt: "2026-09-12T12:00:00.000Z",
    expiresAt: "2026-09-12T12:10:00.000Z",
    calls: [{ to: TOKEN, data: encodeUsdcTransfer(RECIPIENT, BigInt(1_000_000)), value: "0" }],
    amounts: [{
      assetId: "usdc",
      symbol: "USDC",
      decimals: 6,
      amountBaseUnits: "1000000",
      direction: "spend",
    }],
    warnings: [],
    owner: {
      subject: "subject-a",
      address: ACCOUNT,
      chainId: 8453,
      accountProvider: "cdp-embedded",
    },
  };
}

function cashoutAction(): PreparedMoneyAction {
  return {
    ...resumedAction("cash-out"),
    title: "Cash out with Peer",
    calls: [{ to: "0x777777779d229cdF3110e9de47943791c26300Ef", data: "0x1234", value: "0" }],
    amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "spend" }],
    metadata: {
      product: "cashout", operation: "deposit", providerId: "peer", providerName: "Peer", environment: "production",
      platform: "cashapp", platformLabel: "Cash App", currency: "USD", canonicalHandle: "alice", approximateFiatAmount: "1", etaSeconds: 60,
      minConversionRate: "1", intentAmountRange: { min: "1000000", max: "1000000" },
      estimateAsOf: "2026-09-14T12:00:00.000Z", escrow: "0x777777779d229cdF3110e9de47943791c26300Ef",
    },
  };
}

function withdrawAction(): PreparedMoneyAction {
  return {
    ...resumedAction("cash-out-withdraw"),
    title: "Withdraw cash-out",
    calls: [{ to: "0x777777779d229cdF3110e9de47943791c26300Ef", data: "0x1234", value: "0" }],
    amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "2000000", direction: "receive" }],
    metadata: {
      product: "cashout", operation: "withdraw", providerId: "peer", providerName: "Peer", environment: "production",
      platform: "cashapp", platformLabel: "Cash App", currency: "USD", depositId: "0xescrow_7", approximateFiatAmount: "0", etaSeconds: null,
      minConversionRate: "1", intentAmountRange: { min: "2000000", max: "2000000" },
      estimateAsOf: "2026-09-14T12:00:00.000Z", escrow: "0x777777779d229cdF3110e9de47943791c26300Ef",
    },
  };
}

const recoveryOrder = {
  providerId: "peer", providerName: "Peer", assetId: "base:usdc", assetSymbol: "USDC", assetDecimals: 6,
  depositId: "0xescrow_7", state: "awaiting-buyer", platform: "cashapp", platformLabel: "Cash App", currency: "USD",
  canonicalHandle: null, amountAtomic: "2000000", remainingAmountAtomic: "2000000", nextActions: ["withdraw"] as const,
};

const offrampResponse = {
  version: 2,
  direction: "offramp",
  providers: [{
    direction: "offramp", providerId: "peer", displayName: "Peer", region: "US", assetId: "base:usdc",
    assetSymbol: "USDC", assetDecimals: 6, currency: "USD", quotes: false, kyc: null,
    paymentMethods: [{ id: "cashapp", label: "Cash App", platform: "cashapp", handleHint: "Cashtag", minimumAmountAtomic: "10000", maximumAmountAtomic: null, estimateSemantics: "approximate", etaSemantics: "historical-not-guaranteed", corridorConfirmedBy: "pending" }],
  }],
};

afterEach(cleanup);

describe("SendDialog availability", () => {
  test("uses exact base units for Max instead of parsing the display label", () => {
    const usdc = getTransferAsset("usdc");
    if (!usdc) throw new Error("missing USDC transfer asset");

    render(
      <SendDialog
        open
        immediate
        address={ACCOUNT}
        ownerBoundary="owner-a"
        availableAssets={[{
          ...usdc,
          balanceBaseUnits: "1234567",
          balanceLabel: "display copy only",
        }]}
        prepareMoneyAction={async () => resumedAction()}
        resumeMoneyAction={async () => resumedAction()}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })}
        onClose={() => {}}
      />,
    );

    fireEvent.click(page().getByRole("button", { name: "Max" }));
    const amountField = document.querySelector(
      "[data-primary-amount] [data-slot=\"money-ticker\"]",
    );

    expect(amountField?.getAttribute("aria-label")).toBe("$1.234567");
    expect(amountField?.getAttribute("aria-label")).not.toContain("display copy only");
    expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false);
  });

  test("appends a stale snapshot age to the available label", () => {
    const usdc = getTransferAsset("usdc");
    if (!usdc) throw new Error("missing USDC transfer asset");

    render(
      <SendDialog
        open
        immediate
        address={ACCOUNT}
        ownerBoundary="owner-a"
        availableAssets={[{
          ...usdc,
          balanceBaseUnits: "1234567",
          balanceLabel: "$1.23",
          balanceAgeLabel: "Updated 3 min ago",
        }]}
        prepareMoneyAction={async () => resumedAction()}
        resumeMoneyAction={async () => resumedAction()}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })}
        onClose={() => {}}
      />,
    );

    expect(page().getByText("Updated 3 min ago", { exact: false })).toBeTruthy();
  });
});

describe("SendDialog Peer cash-out", () => {
  test("shows the route only after eligible discovery and requires verbatim canonical-handle confirmation", async () => {
    const prepares: Array<{ kind: string; params: unknown }> = [];
    const fetches: string[] = [];
    render(
      <SendDialog
        open immediate address={ACCOUNT} ownerBoundary="owner-peer" regionId="US"
        availableAssets={[{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" }]}
        fetchAccountResource={async (url) => {
          fetches.push(url);
          return url.startsWith("/api/funding/providers") ? offrampResponse : { version: 3, recoveryEligible: false, orders: [] };
        }}
        prepareMoneyAction={async (kind, params) => { prepares.push({ kind, params }); return cashoutAction(); }}
        resumeMoneyAction={async () => cashoutAction()}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })}
        onClose={() => {}}
      />,
    );

    fireEvent.click(page().getByRole("button", { name: "1" }));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    const peer = await page().findByRole("button", { name: /Available payout apps: Cash App.*Send to Zelle, Venmo, Cash App and more.*Use Peer to send via app/ });
    expect(peer).toBeTruthy();
    fireEvent.click(peer);
    fireEvent.click(page().getByRole("button", { name: "Cash App" }));
    fireEvent.input(page().getByLabelText("Cash App handle"), { target: { value: "$alice" } });
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    expect(page().getByText("alice")).toBeTruthy();
    expect((page().getByRole("button", { name: "Review" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.input(page().getByLabelText("Re-enter handle"), { target: { value: "alice" } });
    fireEvent.click(page().getByRole("button", { name: "Review" }));
    expect(await page().findByRole("button", { name: "Cash out 1 USDC" })).toBeTruthy();
    expect(document.body.textContent).toContain("≈ 1 USD");
    expect(document.body.textContent).toContain("About 1 min");
    expect(prepares).toEqual([{ kind: "cash-out", params: expect.objectContaining({ payoutHandle: "$alice", canonicalHandleConfirmation: "alice", amountBaseUnits: "1000000" }) }]);
    await waitFor(() => expect(fetches).toHaveLength(2));
  });

  test("does not show Peer when discovery is unavailable", async () => {
    render(
      <SendDialog open immediate address={ACCOUNT} ownerBoundary="owner-no-peer"
        availableAssets={[{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" }]}
        fetchAccountResource={async () => { throw new Error("offline"); }}
        prepareMoneyAction={async () => resumedAction()} resumeMoneyAction={async () => resumedAction()}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })} onClose={() => {}} />,
    );
    fireEvent.click(page().getByRole("button", { name: "1" }));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    expect(page().queryByRole("button", { name: /Send to Zelle, Venmo, Cash App and more/ })).toBeNull();
    expect(page().queryByRole("button", { name: "Recover a Peer cash-out" })).toBeNull();
    expect(page().getByLabelText("To")).toBeTruthy();
    expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  });

  test("waits for settled reads and hides an empty explicit recovery result", async () => {
    let resolveProviders!: (value: unknown) => void;
    const providerRead = new Promise<unknown>((resolve) => { resolveProviders = resolve; });
    let orderReads = 0;
    render(
      <SendDialog open immediate address={ACCOUNT} ownerBoundary="owner-peer-empty-recovery" regionId="US"
        availableAssets={[]}
        fetchAccountResource={async (url) => {
          if (url.startsWith("/api/funding/providers")) return await providerRead;
          orderReads += 1;
          return { version: 3, recoveryEligible: true, orders: [] };
        }}
        prepareMoneyAction={async () => withdrawAction()} resumeMoneyAction={async () => withdrawAction()}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })} onClose={() => {}} />,
    );

    await waitFor(() => expect(orderReads).toBe(1));
    expect(page().queryByRole("button", { name: "Recover a Peer cash-out" })).toBeNull();
    resolveProviders({ version: 2, direction: "offramp", providers: [] });
    const recover = await page().findByRole("button", { name: "Recover a Peer cash-out" });
    fireEvent.click(recover);
    await waitFor(() => expect(orderReads).toBe(2));
    expect(page().queryByRole("button", { name: "Recover a Peer cash-out" })).toBeNull();
  });

  test("shows and prepares withdrawal recovery without enabled-provider discovery", async () => {
    const prepares: Array<{ kind: string; params: unknown }> = [];
    render(
      <SendDialog open immediate address={ACCOUNT} ownerBoundary="owner-peer-recovery" regionId="US"
        availableAssets={[{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" }]}
        fetchAccountResource={async (url) => url.startsWith("/api/funding/providers")
          ? { version: 2, direction: "offramp", providers: [] }
          : { version: 3, recoveryEligible: true, orders: [recoveryOrder] }}
        prepareMoneyAction={async (kind, params) => { prepares.push({ kind, params }); return withdrawAction(); }}
        resumeMoneyAction={async () => withdrawAction()}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })} onClose={() => {}} />,
    );

    fireEvent.click(page().getByRole("button", { name: "1" }));
    await waitFor(() => expect(page().queryByRole("button", { name: /Withdraw 2 USDC.*Peer cash-out.*awaiting-buyer/ })).toBeNull());
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    const recovery = await page().findByRole("button", { name: /Withdraw 2 USDC.*Peer cash-out.*awaiting-buyer/ });
    expect(recovery).toBeTruthy();
    expect(page().queryByRole("button", { name: /Send to Zelle, Venmo, Cash App and more/ })).toBeNull();
    fireEvent.click(recovery);
    expect(await page().findByRole("button", { name: "Withdraw 2 USDC" })).toBeTruthy();
    expect(prepares).toEqual([{
      kind: "cash-out-withdraw",
      params: { providerId: "peer", region: "US", depositId: "0xescrow_7" },
    }]);
  });
});

describe("SendDialog resume", () => {
  test("resumes only a send action and decodes its recipient from server-authored calldata", async () => {
    let invalidResumes = 0;
    const view = render(
      <SendDialog
        open
        immediate
        address={ACCOUNT}
        ownerBoundary="owner-a"
        resumeActionId={ACTION_ID}
        prepareMoneyAction={async () => resumedAction()}
        resumeMoneyAction={async () => resumedAction()}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })}
        onInvalidResume={() => { invalidResumes += 1; }}
        onClose={() => {}}
      />,
    );

    expect(await page().findByRole("button", { name: "Send $1.00" })).toBeTruthy();
    expect(page().getByRole("button", { name: `Copy ${RECIPIENT}` })).toBeTruthy();
    expect(invalidResumes).toBe(0);

    view.rerender(
      <SendDialog
        open
        immediate
        address={ACCOUNT}
        ownerBoundary="owner-a"
        resumeActionId="22222222-2222-4222-8222-222222222222"
        prepareMoneyAction={async () => resumedAction()}
        resumeMoneyAction={async () => resumedAction("savings-deposit")}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })}
        onInvalidResume={() => { invalidResumes += 1; }}
        onClose={() => {}}
      />,
    );

    expect(await page().findByRole("button", { name: "Continue" })).toBeTruthy();
    expect(invalidResumes).toBe(1);
  });

  test("offers withdrawal recovery on the amount step when there are no sendable balances", async () => {
    render(
      <SendDialog open immediate address={ACCOUNT} ownerBoundary="owner-empty-recovery" regionId="US"
        availableAssets={[]}
        fetchAccountResource={async (url) => url.startsWith("/api/funding/providers")
          ? { version: 2, direction: "offramp", providers: [] }
          : { version: 3, recoveryEligible: true, orders: [recoveryOrder] }}
        prepareMoneyAction={async () => withdrawAction()} resumeMoneyAction={async () => withdrawAction()}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })} onClose={() => {}} />,
    );

    const recovery = await page().findByRole("button", { name: /Withdraw 2 USDC.*Peer cash-out.*awaiting-buyer/ });
    expect(recovery).toBeTruthy();
    fireEvent.click(recovery);
    expect(await page().findByText("You're withdrawing from Peer")).toBeTruthy();
  });

  test("resumes a pending USDC withdrawal exactly when only ETH is sendable", async () => {
    let invalidResumes = 0;
    render(
      <SendDialog
        open immediate address={ACCOUNT} ownerBoundary="owner-withdraw-resume" resumeActionId={ACTION_ID}
        availableAssets={[{ ...getTransferAsset("eth")!, balanceBaseUnits: "1000000000000000000", balanceLabel: "$4,000.00" }]}
        prepareMoneyAction={async () => withdrawAction()} resumeMoneyAction={async () => withdrawAction()}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })}
        onInvalidResume={() => { invalidResumes += 1; }} onClose={() => {}}
      />,
    );

    expect(await page().findByRole("button", { name: "Withdraw 2 USDC" })).toBeTruthy();
    expect(document.body.textContent).toContain("You're withdrawing from Peer");
    expect(document.body.textContent).toContain("Cash App");
    expect(invalidResumes).toBe(0);
  });

  test("keeps an ordinary send review open when the wallet resolves rejected", async () => {
    let closes = 0;
    render(
      <SendDialog
        open immediate address={ACCOUNT} ownerBoundary="owner-rejected-send" resumeActionId={ACTION_ID}
        prepareMoneyAction={async () => resumedAction()} resumeMoneyAction={async () => resumedAction()}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "rejected" })}
        onClose={() => { closes += 1; }}
      />,
    );

    fireEvent.click(await page().findByRole("button", { name: "Send $1.00" }));
    expect((await page().findByRole("alert")).textContent).toBe(
      "The wallet request was rejected. Your reviewed send is still ready to retry.",
    );
    expect(page().getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(page().getByRole("button", { name: `Copy ${RECIPIENT}` })).toBeTruthy();
    expect(closes).toBe(0);
  });

  test("keeps a cash-out review and canonical handle open when the wallet resolves rejected", async () => {
    let closes = 0;
    render(
      <SendDialog
        open immediate address={ACCOUNT} ownerBoundary="owner-rejected-cashout" resumeActionId={ACTION_ID}
        availableAssets={[{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" }]}
        prepareMoneyAction={async () => cashoutAction()} resumeMoneyAction={async () => cashoutAction()}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "rejected" })}
        onClose={() => { closes += 1; }}
      />,
    );

    fireEvent.click(await page().findByRole("button", { name: "Cash out 1 USDC" }));
    expect((await page().findByRole("alert")).textContent).toBe(
      "The wallet request was rejected. Your reviewed cash-out is still ready to retry.",
    );
    expect(page().getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(document.body.textContent).toContain("alice");
    expect(document.body.textContent).toContain("Cash App");
    expect(closes).toBe(0);
  });

  test("treats a resolved failed operation as retryable without closing", async () => {
    render(
      <SendDialog
        open immediate address={ACCOUNT} ownerBoundary="owner-failed-send" resumeActionId={ACTION_ID}
        prepareMoneyAction={async () => resumedAction()} resumeMoneyAction={async () => resumedAction()}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "failed" })} onClose={() => {}}
      />,
    );
    fireEvent.click(await page().findByRole("button", { name: "Send $1.00" }));
    expect((await page().findByRole("alert")).textContent).toBe(
      "The wallet could not submit this action. Your review is still ready to retry.",
    );
    expect(page().getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  test("returns to the first step when confirm reports an unavailable review", async () => {
    for (const status of [404, 410]) {
      let invalidResumes = 0;
      render(
        <SendDialog
          open
          immediate
          address={ACCOUNT}
          ownerBoundary={`owner-${status}`}
          resumeActionId={ACTION_ID}
          prepareMoneyAction={async () => resumedAction()}
          resumeMoneyAction={async () => resumedAction()}
          executeMoneyAction={async () => {
            throw Object.assign(new TransferExecutionError("unavailable"), { status });
          }}
          onInvalidResume={() => { invalidResumes += 1; }}
          onClose={() => {}}
        />,
      );

      fireEvent.click(await page().findByRole("button", { name: "Send $1.00" }));
      expect((await page().findByRole("alert")).textContent).toBe(
        "This review is no longer available — start again.",
      );
      expect(page().getByRole("button", { name: "Continue" })).toBeTruthy();
      expect(invalidResumes).toBe(1);
      cleanup();
    }
  });
});
