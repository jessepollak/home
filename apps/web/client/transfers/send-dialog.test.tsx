import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { afterEach, describe, expect, test } from "bun:test";
import { useState, type ComponentProps } from "react";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { formatAddress } from "@/shared/formatting";
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
    expiresAt: "2099-09-12T12:10:00.000Z",
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

const feeResponse = { version: 1, usdcReserveBaseUnits: "20000" };

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
    expect((page().getByRole("textbox", { name: "Amount" }) as HTMLInputElement).value).toBe("1.234567");
    expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false);
  });

});

describe("SendDialog review", () => {
  test("defers resuming a route action until the region settles", async () => {
    const resumes: string[] = [];
    const props: ComponentProps<typeof SendDialog> = {
      open: true, immediate: true, address: ACCOUNT, ownerBoundary: "owner-pending-resume", resumeActionId: ACTION_ID,
      prepareMoneyAction: async () => resumedAction(),
      resumeMoneyAction: async (id) => { resumes.push(id); return resumedAction(); },
      executeMoneyAction: async () => ({ id: ACTION_ID, status: "submitted" }), onClose: () => {},
    };
    const view = render(<SendDialog {...props} regionReady={false} />);
    expect(page().getByRole("dialog", { name: "Send" })).toBeTruthy();
    expect(resumes).toEqual([]);

    view.rerender(<SendDialog {...props} regionId="DE" regionReady />);
    await waitFor(() => expect(resumes).toEqual([ACTION_ID]));
    expect(await page().findByRole("dialog", { name: "Confirm" })).toBeTruthy();
  });

  test("keeps the prepared review on screen when the route adopts its action id", async () => {
    const resumes: string[] = [];
    const reviews: string[] = [];
    let releasePrepare!: (action: PreparedMoneyAction) => void;
    function RoutedSend() {
      const [actionId, setActionId] = useState<string | null>(null);
      return <SendDialog
        open immediate address={ACCOUNT} ownerBoundary="owner-routed-review" resumeActionId={actionId}
        availableAssets={[{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" }]}
        prepareMoneyAction={() => new Promise((resolve) => { releasePrepare = resolve; })}
        resumeMoneyAction={(id) => { resumes.push(id); return new Promise(() => {}); }}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })}
        onReview={(id) => { reviews.push(id); setActionId(id); }}
        onClose={() => {}}
      />;
    }
    render(<RoutedSend />);

    fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText: async () => RECIPIENT } });
    try {
      fireEvent.click(page().getByRole("button", { name: "Paste address" }));
      await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
    } finally {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    }
    fireEvent.click(page().getByRole("button", { name: "Continue" }));

    expect(await page().findByText("Preparing review…")).toBeTruthy();
    expect((page().getByRole("button", { name: "Close send dialog" }) as HTMLButtonElement).disabled).toBe(true);
    expect(page().queryByText("Waiting for your wallet…")).toBeNull();

    await act(async () => { releasePrepare(resumedAction()); });

    expect(await page().findByRole("button", { name: "Send $1.00" })).toBeTruthy();
    expect(page().queryByText("Waiting for your wallet…")).toBeNull();
    expect(page().queryByText("Preparing review…")).toBeNull();
    expect(page().getByText("From").closest("dl")?.querySelector("dt")?.textContent).toBe("From");
    expect(page().getByRole("button", { name: `Copy ${formatAddress(resumedAction().owner.address)}` })).toBeTruthy();
    expect(reviews).toEqual([ACTION_ID]);
    expect(resumes).toEqual([]);
  });
});

describe("SendDialog Peer cash-out", () => {
  test("waits for the settled region before discovering cash-out destinations and orders", async () => {
    const requests: string[] = [];
    const props: ComponentProps<typeof SendDialog> = {
      open: true, immediate: true, address: ACCOUNT, ownerBoundary: "owner-region-pending", regionId: "US",
      availableAssets: [{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" }],
      fetchAccountResource: async (url) => {
        requests.push(url);
        return url === "/api/actions/network-fee" ? feeResponse : url.startsWith("/api/funding/providers")
          ? { ...offrampResponse, providers: [{ ...offrampResponse.providers[0], region: "DE", currency: "EUR" }] }
          : { version: 3, recoveryEligible: false, orders: [] };
      },
      prepareMoneyAction: async () => cashoutAction(), resumeMoneyAction: async () => cashoutAction(),
      executeMoneyAction: async () => ({ id: ACTION_ID, status: "submitted" }), onClose: () => {},
    };
    const view = render(<SendDialog {...props} regionReady={false} />);
    fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    expect(page().getByLabelText("To")).toBeTruthy();
    expect(page().queryByRole("button", { name: /Send to Cash App/ })).toBeNull();
    expect(page().queryByRole("button", { name: /Withdraw|Recover a Peer cash-out/ })).toBeNull();
    expect(page().queryByText(/Cash out isn't available/)).toBeNull();
    expect(requests.filter((url) => url.startsWith("/api/funding/"))).toEqual([]);

    view.rerender(<SendDialog {...props} regionId="DE" regionReady />);
    await waitFor(() => expect(requests.filter((url) => url.startsWith("/api/funding/"))).toEqual([
      "/api/funding/providers?region=DE&direction=offramp",
      "/api/funding/offramp/orders?region=DE&inFlight=1",
    ]));
    expect(await page().findByRole("button", { name: /Send to Cash App/ })).toBeTruthy();
  });

  test("names only the payout apps in the loaded regional binding", async () => {
    for (const [region, currency, methods, title] of [
      ["DE", "EUR", [{ id: "revolut", label: "Revolut" }], "Send to Revolut"],
      ["US", "USD", [{ id: "cashapp", label: "Cash App" }, { id: "zelle", label: "Zelle" }], "Send to Cash App or Zelle"],
      ["GB", "GBP", [{ id: "monzo", label: "Monzo" }, { id: "revolut", label: "Revolut" }, { id: "other", label: "Other" }], "Send to Monzo, Revolut or Other"],
    ] as const) {
      const view = render(
        <SendDialog open immediate address={ACCOUNT} ownerBoundary={`owner-${region}`} regionId={region}
          availableAssets={[{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" }]}
          fetchAccountResource={async (url) => url === "/api/actions/network-fee" ? feeResponse : url.startsWith("/api/funding/providers")
            ? { ...offrampResponse, providers: [{ ...offrampResponse.providers[0], region, currency, paymentMethods: methods.map((method) => ({ ...offrampResponse.providers[0]!.paymentMethods[0], ...method, platform: method.id })) }] }
            : { version: 3, recoveryEligible: false, orders: [] }}
          prepareMoneyAction={async () => cashoutAction()} resumeMoneyAction={async () => cashoutAction()}
          executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })} onClose={() => {}} />,
      );
      fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
      await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(page().getByRole("button", { name: "Continue" }));
      expect(await page().findByRole("button", { name: new RegExp(title) })).toBeTruthy();
      expect(page().queryByText(/Venmo/)).toBeNull();
      view.unmount();
    }
  });

  test("shows the empty corridor only after a successful empty provider read", async () => {
    let resolveProviders!: (value: unknown) => void;
    const pendingProviders = new Promise<unknown>((resolve) => { resolveProviders = resolve; });
    render(
      <SendDialog open immediate address={ACCOUNT} ownerBoundary="owner-au" regionId="AU"
        availableAssets={[{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" }]}
        fetchAccountResource={async (url) => url === "/api/actions/network-fee" ? feeResponse : url.startsWith("/api/funding/providers") ? pendingProviders : { version: 3, recoveryEligible: false, orders: [] }}
        prepareMoneyAction={async () => cashoutAction()} resumeMoneyAction={async () => cashoutAction()}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })} onClose={() => {}} />,
    );
    fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    expect(page().queryByText("Cash out isn't available in Australia yet.")).toBeNull();
    await act(async () => { resolveProviders({ version: 2, direction: "offramp", providers: [] }); await pendingProviders; });
    expect(page().getByRole("status").textContent).toBe("Cash out isn't available in Australia yet.");
    expect(page().getByLabelText("To")).toBeTruthy();
  });

  test("does not report an unavailable corridor when the selected asset is not USDC", async () => {
    render(
      <SendDialog open immediate address={ACCOUNT} ownerBoundary="owner-de-eth" regionId="DE"
        availableAssets={[{ ...getTransferAsset("eth")!, balanceBaseUnits: "1000000000000000000", balanceLabel: "$4,000.00" }]}
        fetchAccountResource={async (url) => url.startsWith("/api/funding/providers")
          ? { ...offrampResponse, providers: [{ ...offrampResponse.providers[0], region: "DE", currency: "EUR" }] }
          : { version: 3, recoveryEligible: false, orders: [] }}
        prepareMoneyAction={async () => cashoutAction()} resumeMoneyAction={async () => cashoutAction()}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })} onClose={() => {}} />,
    );
    fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await act(async () => {});
    expect(page().queryByText(/Cash out isn't available/)).toBeNull();
    expect(page().queryByRole("button", { name: /Send to Cash App/ })).toBeNull();
  });
  test("shows the route only after eligible discovery and requires verbatim canonical-handle confirmation", async () => {
    const prepares: Array<{ kind: string; params: unknown }> = [];
    const fetches: string[] = [];
    render(
      <SendDialog
        open immediate address={ACCOUNT} ownerBoundary="owner-peer" regionId="US"
        availableAssets={[{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" }]}
        fetchAccountResource={async (url) => {
          fetches.push(url);
          return url === "/api/actions/network-fee" ? feeResponse : url.startsWith("/api/funding/providers") ? offrampResponse : { version: 3, recoveryEligible: false, orders: [] };
        }}
        prepareMoneyAction={async (kind, params) => { prepares.push({ kind, params }); return cashoutAction(); }}
        resumeMoneyAction={async () => cashoutAction()}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })}
        onClose={() => {}}
      />,
    );

    fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    const peer = await page().findByRole("button", { name: /Available payout apps: Cash App.*Send to Cash App.*Use Peer to send via app/ });
    expect(peer).toBeTruthy();
    fireEvent.click(peer);
    fireEvent.click(page().getByRole("button", { name: "Cash App" }));
    fireEvent.input(page().getByLabelText("Cash App handle"), { target: { value: "$alice" } });
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    expect(page().getByText("alice")).toBeTruthy();
    expect((page().getByRole("button", { name: "Review" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.input(page().getByLabelText("Re-enter handle"), { target: { value: "alice" } });
    fireEvent.click(page().getByRole("button", { name: "Review" }));
    expect(await page().findByRole("button", { name: "Cash out $1.00" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Cash out $1.00" }).getAttribute("data-money-action-id")).toBe(ACTION_ID);
    expect(page().getAllByRole("button", { name: "Back" }).every((button) => !button.hasAttribute("data-money-action-id"))).toBe(true);
    expect(page().getByText("From").closest("dl")?.querySelector("dt")?.textContent).toBe("From");
    expect(page().getByRole("button", { name: `Copy ${formatAddress(cashoutAction().owner.address)}` })).toBeTruthy();
    expect(document.body.textContent).toContain("≈ 1 USD");
    expect(document.body.textContent).toContain("About 1 min");
    expect(document.body.textContent).toContain("approximate, not guaranteed");
    expect(prepares).toEqual([{ kind: "cash-out", params: expect.objectContaining({ payoutHandle: "$alice", canonicalHandleConfirmation: "alice", amountBaseUnits: "1000000" }) }]);
    await waitFor(() => expect(fetches.filter((url) => url.startsWith("/api/funding"))).toHaveLength(2));
  });

  test("renders cash-out handle fields with input hints", async () => {
    render(
      <SendDialog
        open immediate address={ACCOUNT} ownerBoundary="owner-peer-hints" regionId="US"
        availableAssets={[{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" }]}
        fetchAccountResource={async (url) => url === "/api/actions/network-fee" ? feeResponse : url.startsWith("/api/funding/providers")
          ? offrampResponse
          : { version: 3, recoveryEligible: false, orders: [] }}
        prepareMoneyAction={async () => cashoutAction()} resumeMoneyAction={async () => cashoutAction()}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })} onClose={() => {}} />,
    );

    fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    const peer = await page().findByRole("button", { name: /Send to Cash App/ });
    fireEvent.click(peer);
    fireEvent.click(page().getByRole("button", { name: "Cash App" }));

    const handle = page().getByLabelText("Cash App handle") as HTMLInputElement;
    expect(handle.getAttribute("autocomplete")).toBe("off");
    expect(handle.getAttribute("autocapitalize")).toBe("none");
    expect(handle.getAttribute("autocorrect")).toBe("off");
    expect(handle.getAttribute("spellcheck")).toBe("false");
    expect(handle.getAttribute("enterkeyhint")).toBe("next");

    fireEvent.input(handle, { target: { value: "$alice" } });
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    const confirmation = page().getByLabelText("Re-enter handle") as HTMLInputElement;
    expect(confirmation.getAttribute("autocomplete")).toBe("off");
    expect(confirmation.getAttribute("autocapitalize")).toBe("none");
    expect(confirmation.getAttribute("autocorrect")).toBe("off");
    expect(confirmation.getAttribute("spellcheck")).toBe("false");
    expect(confirmation.getAttribute("enterkeyhint")).toBe("done");
  });

  test("does not show Peer when discovery is unavailable", async () => {
    render(
      <SendDialog open immediate address={ACCOUNT} ownerBoundary="owner-no-peer"
        availableAssets={[{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" }]}
        fetchAccountResource={async (url) => { if (url === "/api/actions/network-fee") return feeResponse; throw new Error("offline"); }}
        prepareMoneyAction={async () => resumedAction()} resumeMoneyAction={async () => resumedAction()}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })} onClose={() => {}} />,
    );
    fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await waitFor(() => {
      expect(page().queryByRole("button", { name: /Send to Cash App/ })).toBeNull();
      expect(page().queryByRole("button", { name: "Recover a Peer cash-out" })).toBeNull();
      expect(page().getByLabelText("To")).toBeTruthy();
      expect(page().queryByText(/Cash out isn't available/)).toBeNull();
      expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
    });
  });

  test("keeps recovery available and retries failed provider discovery without showing an empty corridor", async () => {
    let providerReads = 0;
    let resolveRetry!: (value: unknown) => void;
    const retryRead = new Promise<unknown>((resolve) => { resolveRetry = resolve; });
    render(
      <SendDialog open immediate address={ACCOUNT} ownerBoundary="owner-discovery-down" regionId="DE"
        availableAssets={[{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" }]}
        fetchAccountResource={async (url) => {
          if (url === "/api/actions/network-fee") return feeResponse;
          if (url.startsWith("/api/funding/providers")) {
            providerReads += 1;
            if (providerReads === 1) throw new Error("offline");
            return retryRead;
          }
          return { version: 3, recoveryEligible: true, orders: [] };
        }}
        prepareMoneyAction={async () => resumedAction()} resumeMoneyAction={async () => resumedAction()}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })} onClose={() => {}} />,
    );
    fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    expect(await page().findByText("Cash out is unavailable right now.")).toBeTruthy();
    expect(page().getByRole("button", { name: "Recover a Peer cash-out" })).toBeTruthy();
    expect(page().queryByText(/Cash out isn't available/)).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Try again" }));
    expect(providerReads).toBe(2);
    expect(page().queryByText(/Cash out isn't available/)).toBeNull();
    expect(page().getByRole("button", { name: "Recover a Peer cash-out" })).toBeTruthy();
    await act(async () => {
      resolveRetry({ ...offrampResponse, providers: [{
        ...offrampResponse.providers[0], region: "DE", currency: "EUR",
        paymentMethods: [{ ...offrampResponse.providers[0]!.paymentMethods[0], id: "revolut", label: "Revolut", platform: "revolut" }],
      }] });
      await retryRead;
    });
    expect(page().getByRole("button", { name: /Send to Revolut/ })).toBeTruthy();
    expect(page().queryByText("Cash out is unavailable right now.")).toBeNull();
    expect(page().getByRole("button", { name: "Recover a Peer cash-out" })).toBeTruthy();
    expect(page().queryByText(/Cash out isn't available/)).toBeNull();
  });

  test("waits for settled reads and hides an empty explicit recovery result", async () => {
    let resolveProviders!: (value: unknown) => void;
    const providerRead = new Promise<unknown>((resolve) => { resolveProviders = resolve; });
    let orderReads = 0;
    render(
      <SendDialog open immediate address={ACCOUNT} ownerBoundary="owner-peer-empty-recovery" regionId="US"
        availableAssets={[]}
        fetchAccountResource={async (url) => {
          if (url.startsWith("/api/transfers/recent-recipients")) return { version: 1, recipients: [] };
          if (url.startsWith("/api/funding/providers")) return await providerRead;
          if (url === "/api/actions/network-fee") return { version: 1, usdcReserveBaseUnits: null };
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
        fetchAccountResource={async (url) => url === "/api/actions/network-fee" ? feeResponse : url.startsWith("/api/funding/providers")
          ? { version: 2, direction: "offramp", providers: [] }
          : { version: 3, recoveryEligible: true, orders: [recoveryOrder] }}
        prepareMoneyAction={async (kind, params) => { prepares.push({ kind, params }); return withdrawAction(); }}
        resumeMoneyAction={async () => withdrawAction()}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })} onClose={() => {}} />,
    );

    fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    const recovery = await page().findByRole("button", { name: /Withdraw \$2\.00.*Peer cash-out.*awaiting-buyer/ });
    expect(recovery).toBeTruthy();
    expect(page().queryByRole("button", { name: /Send to Cash App/ })).toBeNull();
    fireEvent.click(recovery);
    expect(await page().findByRole("button", { name: "Withdraw $2.00" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Withdraw $2.00" }).getAttribute("data-money-action-id")).toBe(ACTION_ID);
    expect(page().getByText("From").closest("dl")?.querySelector("dt")?.textContent).toBe("From");
    expect(page().getByRole("button", { name: `Copy ${formatAddress(withdrawAction().owner.address)}` })).toBeTruthy();
    expect(prepares).toEqual([{
      kind: "cash-out-withdraw",
      params: { providerId: "peer", region: "US", depositId: "0xescrow_7" },
    }]);
  });
});

test("cash-out result names the provider without claiming payout delivery", async () => {
  const prepared = { ...cashoutAction(), owner: { ...cashoutAction().owner, subject: "cashout-story" } };
  render(<SendDialog open immediate address={ACCOUNT} ownerBoundary="cashout-result" resumeActionId={ACTION_ID}
    prepareMoneyAction={async () => prepared} resumeMoneyAction={async () => prepared}
    executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })}
    fetchAccountResource={async (url) => url === "/api/actions" ? { actions: [{ id: ACTION_ID, status: "confirmed", owner: prepared.owner }] } : { version: 1, recipients: [] }}
    onClose={() => {}} />);
  fireEvent.click(await page().findByRole("button", { name: "Cash out $1.00" }));
  expect(await page().findByRole("heading", { name: "$1.00 sent to cash out" })).toBeTruthy();
  expect(page().getByText("Peer sends the payout next. Track it in Activity.")).toBeTruthy();
});

test("cash-out withdrawal result describes funds returning to the account, not a payout", async () => {
  const prepared = { ...withdrawAction(), owner: { ...withdrawAction().owner, subject: "withdraw-result" } };
  render(<SendDialog open immediate address={ACCOUNT} ownerBoundary="withdraw-result" resumeActionId={ACTION_ID}
    prepareMoneyAction={async () => prepared} resumeMoneyAction={async () => prepared}
    executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })}
    fetchAccountResource={async (url) => url === "/api/actions" ? { actions: [{ id: ACTION_ID, status: "confirmed", owner: prepared.owner }] } : { version: 1, recipients: [] }}
    onClose={() => {}} />);
  fireEvent.click(await page().findByRole("button", { name: "Withdraw $2.00" }));
  expect(await page().findByRole("heading", { name: "$2.00 returned to your account" })).toBeTruthy();
  expect(page().queryByText(/payout/i)).toBeNull();
});

describe("SendDialog dismissal", () => {
  test("vetoes Escape while the wallet request is pending and keeps its request context", async () => {
    let closes = 0;
    let dispatches = 0;
    let releaseExecution!: (result: { id: string; status: "submitted" }) => void;
    render(
      <SendDialog
        open immediate address={ACCOUNT} ownerBoundary="owner-pending-escape" resumeActionId={ACTION_ID}
        prepareMoneyAction={async () => resumedAction()} resumeMoneyAction={async () => resumedAction()}
        executeMoneyAction={() => {
          dispatches += 1;
          return new Promise((resolve) => { releaseExecution = resolve; });
        }}
        onClose={() => { closes += 1; }}
      />,
    );

    fireEvent.click(await page().findByRole("button", { name: "Send $1.00" }));
    const primary = page().getByRole("button", { name: "Send $1.00" });
    primary.focus();
    expect(primary.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(primary);
    expect(page().queryByText("Waiting for your wallet…")).toBeNull();
    fireEvent.click(primary);
    expect(dispatches).toBe(1);
    expect((page().getByRole("button", { name: "Close send dialog" }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); });

    expect(page().getByRole("dialog", { name: "Confirm" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Send $1.00" })).toBe(primary);
    expect(document.activeElement).toBe(primary);
    expect(page().getByRole("button", { name: `Show full address ${formatAddress(RECIPIENT)}` })).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: `Show full address ${formatAddress(RECIPIENT)}` }));
    expect(await page().findByLabelText(`Full address ${RECIPIENT}`)).toBeTruthy();
    expect(closes).toBe(0);
    expect(dispatches).toBe(1);

    await act(async () => { releaseExecution({ id: ACTION_ID, status: "submitted" }); });
    expect(await page().findByRole("heading", { name: "$1.00 on its way" })).toBeTruthy();
    expect(page().getAllByRole("listitem")).toHaveLength(2);
    expect(page().getByText("Submitted")).toBeTruthy();
    expect(page().getByText("Confirming on Base")).toBeTruthy();
    expect(closes).toBe(0);
    fireEvent.click(page().getByRole("button", { name: "Done" }));
    expect(closes).toBe(1);
  });

  test("dismisses on Escape before a request is dispatched", async () => {
    let closes = 0;
    render(
      <SendDialog
        open immediate address={ACCOUNT} ownerBoundary="owner-amount-escape"
        availableAssets={[{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" }]}
        prepareMoneyAction={async () => resumedAction()} resumeMoneyAction={async () => resumedAction()}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })}
        onClose={() => { closes += 1; }}
      />,
    );

    await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); });

    expect(closes).toBeGreaterThan(0);
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
    expect(page().getByRole("button", { name: "Send $1.00" }).getAttribute("data-money-action-id")).toBe(ACTION_ID);
    expect(page().getAllByRole("button", { name: "Back" }).every((button) => !button.hasAttribute("data-money-action-id"))).toBe(true);
    expect(page().getByRole("button", { name: `Show full address ${formatAddress(RECIPIENT)}` })).toBeTruthy();
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

  test("finishes resuming a review when balances and the wallet client change while the action is loading", async () => {
    const pending: Array<(action: PreparedMoneyAction) => void> = [];
    let invalidResumes = 0;
    const resume = (_id: string) => new Promise<PreparedMoneyAction>((resolve) => { pending.push(resolve); });
    const dialog = (
      resumeMoneyAction: ComponentProps<typeof SendDialog>["resumeMoneyAction"],
      availableAssets?: ComponentProps<typeof SendDialog>["availableAssets"],
    ) => (
      <SendDialog
        open immediate address={ACCOUNT} ownerBoundary="owner-resume-balances" resumeActionId={ACTION_ID}
        availableAssets={availableAssets}
        prepareMoneyAction={async () => resumedAction()} resumeMoneyAction={resumeMoneyAction}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })}
        onInvalidResume={() => { invalidResumes += 1; }} onClose={() => {}}
      />
    );
    const view = render(dialog(resume));
    expect(await page().findByText("Preparing review…")).toBeTruthy();

    view.rerender(dialog((id) => resume(id), [{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" }]));
    expect(pending).toHaveLength(2);
    await act(async () => {
      pending[0]!(resumedAction("savings-deposit"));
      pending[1]!(resumedAction());
    });

    expect(await page().findByRole("button", { name: "Send $1.00" })).toBeTruthy();
    expect(page().queryByText("Preparing review…")).toBeNull();
    expect(invalidResumes).toBe(0);
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

    const recovery = await page().findByRole("button", { name: /Withdraw \$2\.00.*Peer cash-out.*awaiting-buyer/ });
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

    expect(await page().findByRole("button", { name: "Withdraw $2.00" })).toBeTruthy();
    expect(document.body.textContent).toContain("You're withdrawing from Peer");
    expect(document.body.textContent).toContain("Cash App");
    expect(document.body.textContent).not.toContain("approximate, not guaranteed");
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
    expect(page().getByRole("button", { name: `Show full address ${formatAddress(RECIPIENT)}` })).toBeTruthy();
    expect(closes).toBe(0);
  });

  test("an ambiguous submission shows unknown without offering retry", async () => {
    render(<SendDialog open immediate address={ACCOUNT} ownerBoundary="owner-unknown-send" resumeActionId={ACTION_ID}
      prepareMoneyAction={async () => resumedAction()} resumeMoneyAction={async () => resumedAction()}
      executeMoneyAction={async () => { throw new TransferExecutionError("submission-unknown", new Error("provider uncertainty")); }}
      onClose={() => {}} />);
    fireEvent.click(await page().findByRole("button", { name: "Send $1.00" }));
    expect(await page().findByRole("heading", { name: /confirm \$1\.00/ })).toBeTruthy();
    expect(page().getByRole("button", { name: "View in Activity" })).toBeTruthy();
    expect(page().queryByRole("button", { name: /try again|retry/i })).toBeNull();
    expect(page().queryByRole("button", { name: "Back" })).toBeNull();
  });

  test("keeps the generic message when the failure happened before the wallet was asked", async () => {
    render(
      <SendDialog
        open immediate address={ACCOUNT} ownerBoundary="owner-unavailable-send" resumeActionId={ACTION_ID}
        prepareMoneyAction={async () => resumedAction()} resumeMoneyAction={async () => resumedAction()}
        executeMoneyAction={async () => {
          throw new TransferExecutionError("unavailable", new TypeError("Failed to fetch"));
        }}
        onClose={() => {}}
      />,
    );

    fireEvent.click(await page().findByRole("button", { name: "Send $1.00" }));
    expect((await page().findByRole("alert")).textContent).toBe("The wallet result is unknown. Check Activity before trying again.");
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

    fireEvent.click(await page().findByRole("button", { name: "Cash out $1.00" }));
    expect((await page().findByRole("alert")).textContent).toBe(
      "The wallet request was rejected. Your reviewed cash-out is still ready to retry.",
    );
    expect(page().getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(document.body.textContent).toContain("alice");
    expect(document.body.textContent).toContain("Cash App");
    expect(closes).toBe(0);
  });

  test("a typed failed operation offers fresh preparation with the amount kept", async () => {
    let invalidResumes = 0;
    render(<SendDialog open immediate address={ACCOUNT} ownerBoundary="owner-failed-send" resumeActionId={ACTION_ID}
      availableAssets={[{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" }]}
      prepareMoneyAction={async () => resumedAction()} resumeMoneyAction={async () => resumedAction()}
      executeMoneyAction={async () => ({ id: ACTION_ID, status: "failed" })}
      onInvalidResume={() => { invalidResumes += 1; }} onClose={() => {}} />);
    fireEvent.click(await page().findByRole("button", { name: "Send $1.00" }));
    expect(await page().findByRole("heading", { name: /wasn.t sent/ })).toBeTruthy();
    expect(page().queryByRole("button", { name: "Send $1.00" })).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Try again" }));
    expect(page().getByRole("button", { name: "Continue" })).toBeTruthy();
    expect((page().getByRole("textbox", { name: "Amount" }) as HTMLInputElement).value).toBe("1");
    expect(invalidResumes).toBe(1);
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
