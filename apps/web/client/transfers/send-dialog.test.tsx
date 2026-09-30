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
  test("priced Bitcoin offers a unit toggle while USD cash does not, and review keeps native BTC", async () => {
    const requests: string[] = [];
    render(<SendDialog open immediate address={ACCOUNT} ownerBoundary="priced-send" regionId="US"
      availableAssets={[
        { ...getTransferAsset("cbbtc")!, balanceBaseUnits: "1000000", balanceLabel: "0.01 cbBTC", price: { currency: "USD", perUnit: { atoms: "65000", scale: 0 } } },
        { ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00", price: null },
      ]}
      prepareMoneyAction={async (_kind, request) => {
        const send = request as { amountBaseUnits: string };
        requests.push(send.amountBaseUnits);
        return { ...resumedAction(), title: "Send cbBTC", amounts: [{ assetId: "cbbtc", symbol: "cbBTC", decimals: 8, amountBaseUnits: send.amountBaseUnits, direction: "spend" }] };
      }}
      resumeMoneyAction={async () => resumedAction()}
      executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })}
      onClose={() => {}} />);

    expect(page().getByRole("button", { name: /as the primary amount/ })).toBeTruthy();
    expect((page().getByRole("button", { name: "$10" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(page().getByRole("button", { name: /as the primary amount/ }));
    expect((page().getByRole("button", { name: "$10" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "65" } });
    expect((page().getByRole("textbox", { name: "Amount" }) as HTMLInputElement).value).toBe("65");
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    fireEvent.change(page().getByRole("textbox", { name: "To" }), { target: { value: RECIPIENT } });
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    expect(await page().findByText("You're sending cbBTC")).toBeTruthy();
    expect(requests).toEqual(["100000"]);
    expect(page().getByRole("button", { name: /Send 0\.001\s+cbBTC/ })).toBeTruthy();

    cleanup();
    render(<SendDialog open immediate address={ACCOUNT} ownerBoundary="cash-send" regionId="US"
      availableAssets={[{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00", price: null }]}
      prepareMoneyAction={async () => resumedAction()} resumeMoneyAction={async () => resumedAction()}
      executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })} onClose={() => {}} />);
    expect(page().queryByRole("button", { name: /as the primary amount/ })).toBeNull();
  });
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

test("Send review X closes once and Back returns exactly to destination", async () => {
  let closes = 0;
  function Journey() {
    const [open, setOpen] = useState(true);
    return <SendDialog open={open} immediate address={ACCOUNT} ownerBoundary="send-exit"
      availableAssets={[{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" }]}
      prepareMoneyAction={async () => resumedAction()} resumeMoneyAction={async () => resumedAction()}
      executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })}
      onClose={() => { closes++; setOpen(false); }} onClosed={() => {}} />;
  }
  render(<Journey />);
  fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
  fireEvent.click(page().getByRole("button", { name: "Continue" }));
  fireEvent.change(page().getByRole("textbox", { name: "To" }), { target: { value: RECIPIENT } });
  fireEvent.click(page().getByRole("button", { name: "Continue" }));
  expect(await page().findByRole("dialog", { name: "Confirm" })).toBeTruthy();
  fireEvent.click(page().getAllByRole("button", { name: "Back" }).at(-1)!);
  expect(page().getByRole("textbox", { name: "To" })).toBeTruthy();
  expect(page().queryByRole("textbox", { name: "Amount" })).toBeNull();
  expect(page().getAllByRole("dialog")).toHaveLength(1);
  fireEvent.click(page().getByRole("button", { name: "Continue" }));
  await page().findByRole("dialog", { name: "Confirm" });
  fireEvent.click(page().getByRole("button", { name: "Close send dialog" }));
  await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
  expect(closes).toBe(1);
});

test("Send amount navigation keeps one dialog and returns focus to the amount input", async () => {
  render(<>
    <button type="button">Send trigger</button>
    <SendDialog
      open immediate address={ACCOUNT} ownerBoundary="owner-navigation"
      availableAssets={[{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" }]}
      prepareMoneyAction={async () => resumedAction()}
      resumeMoneyAction={async () => resumedAction()}
      executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })}
      onClose={() => {}}
    />
  </>);
  fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
  await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(page().getByRole("button", { name: "Continue" }));
  const dialog = page().getByRole("dialog", { name: "Send" });
  expect(page().getAllByRole("dialog")).toHaveLength(1);
  expect(page().getByLabelText("To")).toBeTruthy();
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect(document.activeElement).not.toBe(page().getByText("Send trigger"));
  fireEvent.click(page().getByRole("button", { name: "Back" }));
  expect(page().getAllByRole("dialog")).toHaveLength(1);
  expect(document.activeElement).toBe(page().getByRole("textbox", { name: "Amount" }));
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
    const routes: Array<string | null> = [];
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
        onInvalidResume={() => { routes.push(null); setActionId(null); }}
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

    await waitFor(() => expect(page().getByRole("button", { name: "Continue" }).getAttribute("aria-busy")).toBe("true"));
    expect(page().getByRole("button", { name: "Continue" }).getAttribute("aria-disabled")).toBe("true");
    expect(page().getByRole("dialog", { name: "Send" })).toBeTruthy();
    expect(page().getByRole("textbox", { name: "To" })).toBeTruthy();
    expect(page().queryByRole("button", { name: "Send $1.00" })).toBeNull();
    expect((page().getByRole("button", { name: "Close send dialog" }) as HTMLButtonElement).disabled).toBe(true);
    expect(page().queryByText("Waiting for your wallet…")).toBeNull();

    await act(async () => { releasePrepare(resumedAction()); });

    expect(await page().findByRole("button", { name: "Send $1.00" })).toBeTruthy();
    expect(page().queryByText("Waiting for your wallet…")).toBeNull();
    expect(page().getByRole("dialog", { name: "Confirm" })).toBeTruthy();
    expect(page().getByText("From").closest("dl")?.querySelector("dt")?.textContent).toBe("From");
    expect(page().getByRole("button", { name: `Copy ${formatAddress(resumedAction().owner.address)}` })).toBeTruthy();
    expect(reviews).toEqual([ACTION_ID]);
    expect(resumes).toEqual([]);

    fireEvent.click(page().getAllByRole("button", { name: "Back" }).at(-1)!);
    expect(page().queryByRole("button", { name: "Send $1.00" })).toBeNull();
    expect(routes).toEqual([null]);
    expect(resumes).toEqual([]);
  });
});

describe("SendDialog Peer cash-out", () => {
  test("waits for the settled region before discovering cash-out destinations", async () => {
    const requests: string[] = [];
    const props: ComponentProps<typeof SendDialog> = {
      open: true, immediate: true, address: ACCOUNT, ownerBoundary: "owner-region-pending", regionId: "US",
      availableAssets: [{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" }],
      fetchAccountResource: async (url) => {
        requests.push(url);
        return url === "/api/actions/network-fee" ? feeResponse : url.startsWith("/api/funding/providers")
          ? { ...offrampResponse, providers: [{ ...offrampResponse.providers[0], region: "DE", currency: "EUR" }] }
          : { version: 1, recipients: [] };
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
            : {}}
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
        fetchAccountResource={async (url) => url === "/api/actions/network-fee" ? feeResponse : url.startsWith("/api/funding/providers") ? pendingProviders : { version: 1, recipients: [] }}
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
          : {}}
        prepareMoneyAction={async () => cashoutAction()} resumeMoneyAction={async () => cashoutAction()}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })} onClose={() => {}} />,
    );
    fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await act(async () => {});
    expect(page().queryByText(/Cash out isn't available/)).toBeNull();
    expect(page().queryByRole("button", { name: /Send to Cash App/ })).toBeNull();
  });
  test("reviews the canonical destination and invalidates the first action on Edit", async () => {
    const prepares: Array<{ kind: string; params: Record<string, unknown> }> = [];
    const fetches: string[] = [];
    render(<SendDialog open immediate address={ACCOUNT} ownerBoundary="owner-peer" regionId="US"
      availableAssets={[{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" }]}
      fetchAccountResource={async (url) => {
        fetches.push(url);
        return url === "/api/actions/network-fee" ? feeResponse : url.startsWith("/api/funding/providers") ? offrampResponse : { version: 1, recipients: [] };
      }}
      prepareMoneyAction={async (kind, params) => {
        prepares.push({ kind, params: params as Record<string, unknown> });
        const payoutHandle = (params as { payoutHandle: string }).payoutHandle;
        return { ...cashoutAction(), id: prepares.length === 1 ? ACTION_ID : "22222222-2222-4222-8222-222222222222",
          metadata: { ...cashoutAction().metadata!, canonicalHandle: payoutHandle.slice(1) } } as PreparedMoneyAction;
      }}
      resumeMoneyAction={async () => cashoutAction()}
      executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })} onClose={() => {}} />);

    fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: /Send to Cash App/ }));
    fireEvent.click(page().getByRole("button", { name: "Cash App" }));
    const handle = page().getByRole("textbox", { name: "Cash App cashtag" }) as HTMLInputElement;
    fireEvent.input(handle, { target: { value: "$alice" } });
    fireEvent.click(page().getByRole("button", { name: "Review" }));
    expect(await page().findByRole("button", { name: "Cash out $1.00" })).toBeTruthy();
    expect(page().queryByRole("textbox", { name: "Re-enter handle" })).toBeNull();
    expect(prepares).toEqual([{ kind: "cash-out", params: expect.objectContaining({ payoutHandle: "$alice", amountBaseUnits: "1000000" }) }]);
    expect(prepares[0]?.params).not.toHaveProperty("canonicalHandleConfirmation");
    const destination = page().getByRole("group", { name: "Payout destination" });
    expect(destination.textContent).toContain("Cash App · Cashtag");
    expect(destination.textContent).toContain("alice");
    expect(page().queryByText("Payout handle")).toBeNull();
    expect(page().queryByText("Payout app")).toBeNull();
    expect(page().getByRole("button", { name: "Cash out $1.00" }).getAttribute("data-money-action-id")).toBe(ACTION_ID);
    expect(destination.querySelector("[data-money-action-id]")).toBeNull();
    expect(document.body.textContent).toContain("≈ $1.00 to Cash App");
    expect(document.body.textContent).toContain("Usually within 1 minute");
    expect(document.body.textContent).toContain("estimates, not guaranteed");
    fireEvent.click(page().getByRole("button", { name: /Details/ }));
    expect(page().getByRole("button", { name: `Copy ${formatAddress(cashoutAction().owner.address)}` })).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Edit Cash App cashtag" }));
    const editing = page().getByRole("textbox", { name: "Cash App cashtag" }) as HTMLInputElement;
    expect(editing.value).toBe("$alice");
    expect(document.activeElement).toBe(editing);
    expect(page().queryByRole("button", { name: "Cash out $1.00" })).toBeNull();
    fireEvent.input(editing, { target: { value: "$bob" } });
    fireEvent.click(page().getByRole("button", { name: "Review" }));
    expect(await page().findByRole("button", { name: "Cash out $1.00" })).toBeTruthy();
    expect(page().getByRole("group", { name: "Payout destination" }).textContent).toContain("bob");
    expect(page().getByRole("group", { name: "Payout destination" }).textContent).not.toContain("alice");
    expect(prepares.map((item) => item.params.payoutHandle)).toEqual(["$alice", "$bob"]);
    expect(page().getByRole("button", { name: "Cash out $1.00" }).getAttribute("data-money-action-id")).toBe("22222222-2222-4222-8222-222222222222");
    await waitFor(() => expect(fetches.filter((url) => url.startsWith("/api/funding/providers"))).toHaveLength(1));
  });
  test("keeps the payout handle step while the cash-out review prepares", async () => {
    let release!: (action: PreparedMoneyAction) => void;
    const prepares: string[] = [];
    render(<SendDialog open immediate address={ACCOUNT} ownerBoundary="owner-peer-preparing" regionId="US"
      availableAssets={[{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" }]}
      fetchAccountResource={async (url) => url === "/api/actions/network-fee" ? feeResponse : url.startsWith("/api/funding/providers") ? offrampResponse : { version: 1, recipients: [] }}
      prepareMoneyAction={(kind) => { prepares.push(kind); return new Promise((resolve) => { release = resolve; }); }}
      resumeMoneyAction={async () => cashoutAction()}
      executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })} onClose={() => {}} />);

    fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: /Send to Cash App/ }));
    fireEvent.click(page().getByRole("button", { name: "Cash App" }));
    const handle = page().getByRole("textbox", { name: "Cash App cashtag" });
    fireEvent.input(handle, { target: { value: "$alice" } });
    fireEvent.click(page().getByRole("button", { name: "Review" }));

    await waitFor(() => expect(page().getByRole("button", { name: "Review" }).getAttribute("aria-busy")).toBe("true"));
    expect(page().getByRole("dialog", { name: "Cash out with Peer" })).toBeTruthy();
    expect(page().getByRole("textbox", { name: "Cash App cashtag" })).toBeTruthy();
    fireEvent.keyDown(handle, { key: "Enter" });
    fireEvent.click(page().getByRole("button", { name: "Review" }));
    expect(prepares).toEqual(["cash-out"]);

    await act(async () => { release({ ...cashoutAction(), metadata: { ...cashoutAction().metadata!, canonicalHandle: "alice" } } as PreparedMoneyAction); });
    expect(await page().findByRole("button", { name: "Cash out $1.00" })).toBeTruthy();
    expect(page().getByRole("dialog", { name: "Confirm" })).toBeTruthy();
  });

  test("a lone dollar sign cannot be reviewed", async () => {
    render(<SendDialog open immediate address={ACCOUNT} ownerBoundary="owner-empty-handle" regionId="US"
      availableAssets={[{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" }]}
      fetchAccountResource={async (url) => url === "/api/actions/network-fee" ? feeResponse : url.startsWith("/api/funding/providers") ? offrampResponse : { version: 1, recipients: [] }}
      prepareMoneyAction={async () => cashoutAction()} resumeMoneyAction={async () => cashoutAction()}
      executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })} onClose={() => {}} />);
    fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: /Send to Cash App/ }));
    fireEvent.click(page().getByRole("button", { name: "Cash App" }));
    fireEvent.input(page().getByRole("textbox", { name: "Cash App cashtag" }), { target: { value: "$" } });
    expect((page().getByRole("button", { name: "Review" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("rejects server metadata that disagrees with the entered destination", async () => {
    render(<SendDialog open immediate address={ACCOUNT} ownerBoundary="owner-mismatched-handle" regionId="US"
      availableAssets={[{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" }]}
      fetchAccountResource={async (url) => url === "/api/actions/network-fee" ? feeResponse : url.startsWith("/api/funding/providers") ? offrampResponse : { version: 1, recipients: [] }}
      prepareMoneyAction={async () => ({ ...cashoutAction(), metadata: { ...cashoutAction().metadata!, canonicalHandle: "someone-else" } } as PreparedMoneyAction)}
      resumeMoneyAction={async () => cashoutAction()}
      executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })} onClose={() => {}} />);
    fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: /Send to Cash App/ }));
    fireEvent.click(page().getByRole("button", { name: "Cash App" }));
    fireEvent.input(page().getByRole("textbox", { name: "Cash App cashtag" }), { target: { value: "$alice" } });
    fireEvent.click(page().getByRole("button", { name: "Review" }));
    expect((await page().findByRole("alert")).textContent).toBe("Check the payout details and try again.");
    expect((page().getByRole("textbox", { name: "Cash App cashtag" }) as HTMLInputElement).value).toBe("$alice");
    expect(page().queryByRole("button", { name: "Cash out $1.00" })).toBeNull();
  });

  test("labels Zelle email and reviews its lowercased destination", async () => {
    const methods = [...offrampResponse.providers[0]!.paymentMethods, { ...offrampResponse.providers[0]!.paymentMethods[0]!, id: "zelle", platform: "zelle", label: "Zelle", handleHint: "Email or phone" }];
    render(<SendDialog open immediate address={ACCOUNT} ownerBoundary="owner-zelle" regionId="US"
      availableAssets={[{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" }]}
      fetchAccountResource={async (url) => url === "/api/actions/network-fee" ? feeResponse : url.startsWith("/api/funding/providers")
        ? { ...offrampResponse, providers: [{ ...offrampResponse.providers[0], paymentMethods: methods }] } : { version: 1, recipients: [] }}
      prepareMoneyAction={async () => ({ ...cashoutAction(), metadata: { ...cashoutAction().metadata!, platform: "zelle", platformLabel: "Zelle", canonicalHandle: "alice@example.com" } } as PreparedMoneyAction)}
      resumeMoneyAction={async () => cashoutAction()}
      executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })} onClose={() => {}} />);
    fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: /Send to Cash App or Zelle/ }));
    fireEvent.click(page().getByRole("button", { name: "Zelle" }));
    fireEvent.input(page().getByRole("textbox", { name: "Zelle email or phone" }), { target: { value: "Alice@Example.COM" } });
    fireEvent.click(page().getByRole("button", { name: "Review" }));
    const destination = await page().findByRole("group", { name: "Payout destination" });
    expect(destination.textContent).toContain("Zelle · Email or phone");
    expect(destination.textContent).toContain("alice@example.com");
  });
  test("renders cash-out handle fields with input hints", async () => {
    render(
      <SendDialog
        open immediate address={ACCOUNT} ownerBoundary="owner-peer-hints" regionId="US"
        availableAssets={[{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" }]}
        fetchAccountResource={async (url) => url === "/api/actions/network-fee" ? feeResponse : url.startsWith("/api/funding/providers")
          ? offrampResponse
          : {}}
        prepareMoneyAction={async () => cashoutAction()} resumeMoneyAction={async () => cashoutAction()}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })} onClose={() => {}} />,
    );

    fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    const peer = await page().findByRole("button", { name: /Send to Cash App/ });
    fireEvent.click(peer);
    fireEvent.click(page().getByRole("button", { name: "Cash App" }));

    const handle = page().getByLabelText("Cash App cashtag") as HTMLInputElement;
    expect(handle.getAttribute("autocomplete")).toBe("off");
    expect(handle.getAttribute("autocapitalize")).toBe("none");
    expect(handle.getAttribute("autocorrect")).toBe("off");
    expect(handle.getAttribute("spellcheck")).toBe("false");
    expect(handle.getAttribute("enterkeyhint")).toBe("go");

    fireEvent.input(handle, { target: { value: "$alice" } });
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(await page().findByRole("button", { name: "Cash out $1.00" })).toBeTruthy();
    expect(page().queryByRole("textbox", { name: "Re-enter handle" })).toBeNull();
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
      expect(page().getByLabelText("To")).toBeTruthy();
      expect(page().queryByText(/Cash out isn't available/)).toBeNull();
      expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
    });
  });

  test("retries failed provider discovery without showing an empty corridor", async () => {
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
          return {};
        }}
        prepareMoneyAction={async () => resumedAction()} resumeMoneyAction={async () => resumedAction()}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })} onClose={() => {}} />,
    );
    fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    expect(await page().findByText("Cash out is unavailable right now.")).toBeTruthy();
    expect(page().queryByText(/Cash out isn't available/)).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Try again" }));
    expect(providerReads).toBe(2);
    expect(page().queryByText(/Cash out isn't available/)).toBeNull();
    await act(async () => {
      resolveRetry({ ...offrampResponse, providers: [{
        ...offrampResponse.providers[0], region: "DE", currency: "EUR",
        paymentMethods: [{ ...offrampResponse.providers[0]!.paymentMethods[0], id: "revolut", label: "Revolut", platform: "revolut" }],
      }] });
      await retryRead;
    });
    expect(page().getByRole("button", { name: /Send to Revolut/ })).toBeTruthy();
    expect(page().queryByText("Cash out is unavailable right now.")).toBeNull();
    expect(page().queryByText(/Cash out isn't available/)).toBeNull();
  });

  test("does not request extra resources when there are no sendable assets", async () => {
    let resolveProviders!: (value: unknown) => void;
    const providerRead = new Promise<unknown>((resolve) => { resolveProviders = resolve; });
    const requests: string[] = [];
    render(
      <SendDialog open immediate address={ACCOUNT} ownerBoundary="owner-peer-empty-recovery" regionId="US"
        availableAssets={[]}
        fetchAccountResource={async (url) => {
          if (url.startsWith("/api/transfers/recent-recipients")) return { version: 1, recipients: [] };
          if (url.startsWith("/api/funding/providers")) return await providerRead;
          if (url === "/api/actions/network-fee") return { version: 1, usdcReserveBaseUnits: null };
          requests.push(url);
          return {};
        }}
        prepareMoneyAction={async () => withdrawAction()} resumeMoneyAction={async () => withdrawAction()}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })} onClose={() => {}} />,
    );

    await act(async () => { resolveProviders({ version: 2, direction: "offramp", providers: [] }); await providerRead; });
    expect(page().getByText("No catalog balance is available to send.")).toBeTruthy();
    expect(requests).toEqual([]);
  });

  test("never exposes order recovery in the destination step", async () => {
    render(
      <SendDialog open immediate address={ACCOUNT} ownerBoundary="owner-no-order-recovery" regionId="US"
        availableAssets={[{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" }]}
        fetchAccountResource={async (url) => url === "/api/actions/network-fee" ? feeResponse : url.startsWith("/api/funding/providers")
          ? { version: 2, direction: "offramp", providers: [] }
          : { version: 1, recipients: [] }}
        prepareMoneyAction={async () => withdrawAction()}
        resumeMoneyAction={async () => withdrawAction()}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })} onClose={() => {}} />,
    );

    fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(page().getByText("Cash out isn't available in United States yet.")).toBeTruthy());
    expect(page().queryByRole("button", { name: /Send to Cash App/ })).toBeNull();
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

describe("SendDialog cash-out requote", () => {
  const quote = (amount: string, seconds = 60) => ({
    fees: { provider: { amount: "0", currency: "USD" }, network: null, operator: null }, rate: null,
    receive: { amount, currency: "USD", approximate: true }, arrival: { source: "observed" as const, kind: "within" as const, seconds },
  });
  const reviewed = (id: string, amount: string, expiresAt = "2099-09-12T12:10:00.000Z"): PreparedMoneyAction => {
    const base = cashoutAction();
    return { ...base, id, expiresAt, metadata: { ...base.metadata!, approximateFiatAmount: amount, quote: quote(amount) } as PreparedMoneyAction["metadata"] };
  };

  test("an expired confirm keeps the review, requotes the same cash-out, and asks again when the amount changed", async () => {
    const prepares: Record<string, unknown>[] = [];
    const executed: string[] = [];
    render(<SendDialog open immediate address={ACCOUNT} ownerBoundary="requote-changed" regionId="US" resumeActionId={ACTION_ID}
      resumeMoneyAction={async () => reviewed(ACTION_ID, "1")}
      prepareMoneyAction={async (_kind, params) => { prepares.push(params as Record<string, unknown>); return reviewed("22222222-2222-4222-8222-222222222222", "0.98"); }}
      executeMoneyAction={async (action) => {
        executed.push(action.id);
        if (action.id === ACTION_ID) throw Object.assign(new Error("expired"), { code: "ACTION_EXPIRED" });
        return { id: action.id, status: "submitted" };
      }}
      fetchAccountResource={async () => ({ version: 1, recipients: [] })} onClose={() => {}} />);

    fireEvent.click(await page().findByRole("button", { name: "Cash out $1.00" }));
    const getNewQuote = await page().findByRole("button", { name: "Get new quote" });
    expect(getNewQuote.hasAttribute("data-money-action-id")).toBe(false);
    expect(page().getByRole("status").textContent).toBe("This quote expired. Get a new quote to continue.");
    expect(document.body.textContent).toContain("≈ $1.00 to Cash App");

    fireEvent.click(getNewQuote);
    expect(await page().findByText("The quote changed. Check what you receive before you cash out.")).toBeTruthy();
    expect(prepares).toEqual([expect.objectContaining({ providerId: "peer", region: "US", amountBaseUnits: "1000000", platform: "cashapp", currency: "USD", payoutHandle: "alice" })]);
    expect(document.body.textContent).toContain("≈ $0.98 to Cash App");
    expect(executed).toEqual([ACTION_ID]);

    const confirmAgain = page().getByRole("button", { name: "Cash out $1.00" });
    expect(confirmAgain.getAttribute("data-money-action-id")).toBe("22222222-2222-4222-8222-222222222222");
    fireEvent.click(confirmAgain);
    await waitFor(() => expect(executed).toEqual([ACTION_ID, "22222222-2222-4222-8222-222222222222"]));
  });

  test("a review that expired on the client requotes without claiming a change when the amount holds", async () => {
    const executed: string[] = [];
    render(<SendDialog open immediate address={ACCOUNT} ownerBoundary="requote-same" regionId="US" resumeActionId={ACTION_ID}
      resumeMoneyAction={async () => reviewed(ACTION_ID, "1", "2000-01-01T00:00:00.000Z")}
      prepareMoneyAction={async () => reviewed("33333333-3333-4333-8333-333333333333", "1.00")}
      executeMoneyAction={async (action) => { executed.push(action.id); return { id: action.id, status: "submitted" }; }}
      fetchAccountResource={async () => ({ version: 1, recipients: [] })} onClose={() => {}} />);

    fireEvent.click(await page().findByRole("button", { name: "Get new quote" }));
    const confirmAgain = await page().findByRole("button", { name: "Cash out $1.00" });
    expect(page().queryByText(/The quote changed/)).toBeNull();
    expect(page().queryByText(/This quote expired/)).toBeNull();
    expect(executed).toEqual([]);
    expect(confirmAgain.getAttribute("data-money-action-id")).toBe("33333333-3333-4333-8333-333333333333");
  });

  test("keeps the expired review on screen while the new quote loads", async () => {
    let release!: (action: PreparedMoneyAction) => void;
    render(<SendDialog open immediate address={ACCOUNT} ownerBoundary="requote-loading" regionId="US" resumeActionId={ACTION_ID}
      resumeMoneyAction={async () => reviewed(ACTION_ID, "1", "2000-01-01T00:00:00.000Z")}
      prepareMoneyAction={() => new Promise((resolve) => { release = resolve; })}
      executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })}
      fetchAccountResource={async () => ({ version: 1, recipients: [] })} onClose={() => {}} />);

    fireEvent.click(await page().findByRole("button", { name: "Get new quote" }));
    await waitFor(() => expect(page().getByRole("button", { name: "Get new quote" }).getAttribute("aria-busy")).toBe("true"));
    expect(page().getByRole("dialog", { name: "Confirm" })).toBeTruthy();
    expect(page().getByRole("group", { name: "Payout destination" }).textContent).toContain("alice");
    expect(page().getByRole("status").textContent).toBe("This quote expired. Get a new quote to continue.");

    await act(async () => { release(reviewed("33333333-3333-4333-8333-333333333333", "1.00")); });
    expect(await page().findByRole("button", { name: "Cash out $1.00" })).toBeTruthy();
  });

  test("a failed requote explains why and keeps a way back", async () => {
    render(<SendDialog open immediate address={ACCOUNT} ownerBoundary="requote-failed" regionId="US" resumeActionId={ACTION_ID}
      resumeMoneyAction={async () => reviewed(ACTION_ID, "1", "2000-01-01T00:00:00.000Z")}
      prepareMoneyAction={async () => { throw Object.assign(new Error("busy"), { code: "CASHOUT_ORDER_IN_FLIGHT", serverMessage: "A cash-out for this amount to this payee is still in progress. Check Activity." }); }}
      executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })}
      fetchAccountResource={async () => ({ version: 1, recipients: [] })} onClose={() => {}} />);

    fireEvent.click(await page().findByRole("button", { name: "Get new quote" }));
    expect((await page().findByRole("alert")).textContent).toContain("still in progress");
    expect(page().getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(page().getAllByRole("button", { name: "Back" }).length).toBeGreaterThan(0);
  });
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
    await waitFor(() => expect(page().getByRole("button", { name: "Continue" }).getAttribute("aria-busy")).toBe("true"));
    expect(page().getByRole("dialog", { name: "Send" })).toBeTruthy();

    view.rerender(dialog((id) => resume(id), [{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" }]));
    expect(pending).toHaveLength(2);
    await act(async () => {
      pending[0]!(resumedAction("savings-deposit"));
      pending[1]!(resumedAction());
    });

    expect(await page().findByRole("button", { name: "Send $1.00" })).toBeTruthy();
    expect(page().getByRole("dialog", { name: "Confirm" })).toBeTruthy();
    expect(invalidResumes).toBe(0);
  });

  test("does not expose order recovery on the amount step without sendable balances", async () => {
    const requests: string[] = [];
    render(
      <SendDialog open immediate address={ACCOUNT} ownerBoundary="owner-empty-no-recovery" regionId="US"
        availableAssets={[]}
        fetchAccountResource={async (url) => { requests.push(url); return url.startsWith("/api/funding/providers")
          ? { version: 2, direction: "offramp", providers: [] }
          : { version: 1, recipients: [] }; }}
        prepareMoneyAction={async () => withdrawAction()} resumeMoneyAction={async () => withdrawAction()}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })} onClose={() => {}} />,
    );

    expect(page().getByText("No catalog balance is available to send.")).toBeTruthy();
    await waitFor(() => expect(requests.some((url) => url.includes("/api/funding/providers"))).toBe(true));
    expect(page().queryByRole("button", { name: /Withdraw/ })).toBeNull();
  });

  test("Edit and Back clear the routed cash-out action so a discarded review cannot resume", async () => {
    const SECOND_ID = "22222222-2222-4222-8222-222222222222";
    const routes: Array<string | null> = [];
    const resumes: string[] = [];
    let prepared = 0;
    function RoutedCashout() {
      const [actionId, setActionId] = useState<string | null>(null);
      return <SendDialog open immediate address={ACCOUNT} ownerBoundary="owner-routed-cashout" regionId="US" resumeActionId={actionId}
        availableAssets={[{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" }]}
        fetchAccountResource={async (url) => url === "/api/actions/network-fee" ? feeResponse : url.startsWith("/api/funding/providers") ? offrampResponse : { version: 1, recipients: [] }}
        prepareMoneyAction={async () => { prepared += 1; return { ...cashoutAction(), id: prepared === 1 ? ACTION_ID : SECOND_ID } as PreparedMoneyAction; }}
        resumeMoneyAction={(id) => { resumes.push(id); return new Promise(() => {}); }}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })}
        onReview={(id) => { routes.push(id); setActionId(id); }}
        onInvalidResume={() => { routes.push(null); setActionId(null); }}
        onClose={() => {}} />;
    }
    render(<RoutedCashout />);

    fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: /Send to Cash App/ }));
    fireEvent.click(page().getByRole("button", { name: "Cash App" }));
    fireEvent.input(page().getByRole("textbox", { name: "Cash App cashtag" }), { target: { value: "$alice" } });
    fireEvent.click(page().getByRole("button", { name: "Review" }));
    expect(await page().findByRole("button", { name: "Cash out $1.00" })).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Edit Cash App cashtag" }));
    expect(routes).toEqual([ACTION_ID, null]);

    fireEvent.click(page().getByRole("button", { name: "Review" }));
    expect(await page().findByRole("button", { name: "Cash out $1.00" })).toBeTruthy();
    fireEvent.click(page().getAllByRole("button", { name: "Back" }).at(-1)!);
    expect(page().getByRole("textbox", { name: "Cash App cashtag" })).toBeTruthy();
    expect(routes).toEqual([ACTION_ID, null, SECOND_ID, null]);
    expect(resumes).toEqual([]);
  });
  test("resumed cash-out Back resolves the loaded binding and preserves the canonical entry", async () => {
    const responses = [offrampResponse, { ...offrampResponse, providers: [] }];
    for (const [index, response] of responses.entries()) {
      const view = render(<SendDialog open immediate address={ACCOUNT} ownerBoundary={`owner-resumed-${index}`} regionId="US" resumeActionId={ACTION_ID}
        availableAssets={[{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" }]}
        fetchAccountResource={async (url) => url === "/api/actions/network-fee" ? feeResponse : url.startsWith("/api/funding/providers") ? response : { version: 1, recipients: [] }}
        prepareMoneyAction={async () => cashoutAction()} resumeMoneyAction={async () => cashoutAction()}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })} onClose={() => {}} />);
      expect(await page().findByRole("button", { name: "Cash out $1.00" })).toBeTruthy();
      await act(async () => {});
      fireEvent.click(page().getAllByRole("button", { name: "Back" }).at(-1)!);
      if (index === 0) {
        expect((page().getByRole("textbox", { name: "Cash App cashtag" }) as HTMLInputElement).value).toBe("alice");
        expect(page().queryByRole("button", { name: "Cash out $1.00" })).toBeNull();
      } else {
        expect(page().getByRole("textbox", { name: "To" })).toBeTruthy();
      }
      view.unmount();
    }
  });

  test("resumes a pending USDC withdrawal exactly when only ETH is sendable", async () => {
    let closes = 0;
    let invalidResumes = 0;
    render(
      <SendDialog
        open immediate address={ACCOUNT} ownerBoundary="owner-withdraw-resume" resumeActionId={ACTION_ID}
        availableAssets={[{ ...getTransferAsset("eth")!, balanceBaseUnits: "1000000000000000000", balanceLabel: "$4,000.00" }]}
        prepareMoneyAction={async () => withdrawAction()} resumeMoneyAction={async () => withdrawAction()}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })}
        onInvalidResume={() => { invalidResumes += 1; }} onClose={() => { closes += 1; }}
      />,
    );

    expect(await page().findByRole("button", { name: "Withdraw $2.00" })).toBeTruthy();
    expect(document.body.textContent).toContain("You're withdrawing from Peer");
    expect(document.body.textContent).toContain("Cash App");
    expect(document.body.textContent).not.toContain("approximate, not guaranteed");
    expect(document.body.textContent).not.toContain("Payout handle");
    expect(invalidResumes).toBe(0);
    fireEvent.click(page().getAllByRole("button", { name: "Back" }).at(-1)!);
    expect(closes).toBe(1);
  });

  test("shows a server CASHOUT_ refusal on the payout handle step", async () => {
    render(<SendDialog open immediate address={ACCOUNT} ownerBoundary="owner-server-refusal" regionId="US"
      availableAssets={[{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" }]}
      fetchAccountResource={async (url) => url === "/api/actions/network-fee" ? feeResponse : url.startsWith("/api/funding/providers") ? offrampResponse : { version: 1, recipients: [] }}
      prepareMoneyAction={async () => { throw { code: "CASHOUT_ORDER_IN_FLIGHT", serverMessage: "A cash-out for this amount to this payee is still in progress. Check Activity." }; }}
      resumeMoneyAction={async () => cashoutAction()}
      executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })} onClose={() => {}} />);
    fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: /Send to Cash App/ }));
    fireEvent.click(page().getByRole("button", { name: "Cash App" }));
    fireEvent.input(page().getByLabelText("Cash App cashtag"), { target: { value: "$alice" } });
    fireEvent.click(page().getByRole("button", { name: "Review" }));
    expect((await page().findByRole("alert")).textContent).toBe("A cash-out for this amount to this payee is still in progress. Check Activity.");
    expect(page().getByLabelText("Cash App cashtag")).toBeTruthy();
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

  test.each(["submission-unknown", "dispatch-unknown"] as const)("an ambiguous %s shows unknown without offering retry", async (reason) => {
    render(<SendDialog open immediate address={ACCOUNT} ownerBoundary="owner-unknown-send" resumeActionId={ACTION_ID}
      prepareMoneyAction={async () => resumedAction()} resumeMoneyAction={async () => resumedAction()}
      executeMoneyAction={async () => { throw new TransferExecutionError(reason, new Error("provider uncertainty")); }}
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
    const failures = [
      { key: "404", details: { status: 404 } },
      { key: "410", details: { status: 410 } },
      { key: "cashout-removed", details: { code: "CASHOUT_UNAVAILABLE" } },
      { key: "cashout-settings", details: { code: "CASHOUT_SETTINGS_UNAVAILABLE" } },
    ];
    for (const { key, details } of failures) {
      let invalidResumes = 0;
      render(
        <SendDialog
          open
          immediate
          address={ACCOUNT}
          ownerBoundary={`owner-${key}`}
          resumeActionId={ACTION_ID}
          prepareMoneyAction={async () => resumedAction()}
          resumeMoneyAction={async () => resumedAction()}
          executeMoneyAction={async () => {
            throw Object.assign(new TransferExecutionError("unavailable"), details);
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

describe("SendDialog in-flight prepare", () => {
  const OTHER = "0x3333333333333333333333333333333333333333" as const;
  const usdcBalance = [{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" }];

  test("locks the destination while the send review prepares and drops a response for an edited recipient", async () => {
    const pending: Array<(action: PreparedMoneyAction) => void> = [];
    const recipients: string[] = [];
    render(<SendDialog open immediate address={ACCOUNT} ownerBoundary="owner-send-fence" regionId="US" availableAssets={usdcBalance}
      fetchAccountResource={async (url) => url === "/api/actions/network-fee" ? feeResponse
        : url.startsWith("/api/funding/providers") ? offrampResponse
        : url === "/api/transfers/recent-recipients" ? { version: 1, recipients: [{ address: OTHER }] } : { version: 1, recipients: [] }}
      prepareMoneyAction={(_kind, request) => {
        recipients.push((request as { recipient: string }).recipient);
        return new Promise((resolve) => { pending.push(resolve); });
      }}
      resumeMoneyAction={async () => resumedAction()}
      executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })} onClose={() => {}} />);

    fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    const to = page().getByRole("textbox", { name: "To" }) as HTMLInputElement;
    fireEvent.change(to, { target: { value: RECIPIENT } });
    const recent = await page().findByRole("button", { name: formatAddress(OTHER) });
    const cashOut = await page().findByRole("button", { name: /Send to Cash App/ });
    act(() => { to.focus(); });
    fireEvent.click(page().getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(page().getByRole("button", { name: "Continue" }).getAttribute("aria-busy")).toBe("true"));
    expect(to.readOnly).toBe(true);
    expect(to.disabled).toBe(false);
    expect(to.getAttribute("aria-readonly")).toBe("true");
    expect(document.activeElement).toBe(to);
    expect((page().getByRole("button", { name: "Paste address" }) as HTMLButtonElement).disabled).toBe(true);
    expect((recent as HTMLButtonElement).disabled).toBe(true);
    expect((cashOut as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(page().getByRole("textbox", { name: "To" }), { target: { value: OTHER } });
    await act(async () => { pending[0]!(resumedAction()); });

    expect(page().queryByRole("dialog", { name: "Confirm" })).toBeNull();
    expect(page().queryByRole("button", { name: "Send $1.00" })).toBeNull();
    expect(page().getByRole("button", { name: "Continue" }).getAttribute("aria-busy")).toBeNull();
    expect(to.readOnly).toBe(false);

    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await act(async () => { pending[1]!({ ...resumedAction(), calls: [{ to: TOKEN, data: encodeUsdcTransfer(OTHER, BigInt(1_000_000)), value: "0" }] }); });
    const review = await page().findByRole("dialog", { name: "Confirm" });
    expect(review.textContent).toContain(formatAddress(OTHER));
    expect(review.textContent).not.toContain(formatAddress(RECIPIENT));
    expect(recipients).toEqual([RECIPIENT, OTHER]);
  });

  test("keeps focus on the read-only payout handle and drops a response for an edited handle", async () => {
    const pending: Array<(action: PreparedMoneyAction) => void> = [];
    const handles: string[] = [];
    render(<SendDialog open immediate address={ACCOUNT} ownerBoundary="owner-handle-fence" regionId="US" availableAssets={usdcBalance}
      fetchAccountResource={async (url) => url === "/api/actions/network-fee" ? feeResponse : url.startsWith("/api/funding/providers") ? offrampResponse : { version: 1, recipients: [] }}
      prepareMoneyAction={(_kind, request) => {
        handles.push((request as { payoutHandle: string }).payoutHandle);
        return new Promise((resolve) => { pending.push(resolve); });
      }}
      resumeMoneyAction={async () => cashoutAction()}
      executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })} onClose={() => {}} />);

    fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: /Send to Cash App/ }));
    fireEvent.click(page().getByRole("button", { name: "Cash App" }));
    const handle = page().getByRole("textbox", { name: "Cash App cashtag" }) as HTMLInputElement;
    fireEvent.input(handle, { target: { value: "$alice" } });
    act(() => { handle.focus(); });
    fireEvent.keyDown(handle, { key: "Enter" });

    await waitFor(() => expect(page().getByRole("button", { name: "Review" }).getAttribute("aria-busy")).toBe("true"));
    expect(handle.readOnly).toBe(true);
    expect(document.activeElement).toBe(handle);

    fireEvent.input(handle, { target: { value: "$bob" } });
    await act(async () => { pending[0]!(cashoutAction()); });

    expect(page().queryByRole("dialog", { name: "Confirm" })).toBeNull();
    expect(handle.value).toBe("$bob");
    expect(handle.readOnly).toBe(false);
    expect(page().getByRole("button", { name: "Review" }).getAttribute("aria-busy")).toBeNull();
    expect(handles).toEqual(["$alice"]);
  });

  test("locks the amount step while a routed review resumes", async () => {
    let release!: (action: PreparedMoneyAction) => void;
    render(<SendDialog open immediate address={ACCOUNT} ownerBoundary="owner-resume-lock" resumeActionId={ACTION_ID}
      availableAssets={[...usdcBalance, { ...getTransferAsset("cbbtc")!, balanceBaseUnits: "1000000", balanceLabel: "0.01 cbBTC" }]}
      prepareMoneyAction={async () => resumedAction()}
      resumeMoneyAction={() => new Promise((resolve) => { release = resolve; })}
      executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })} onClose={() => {}} />);

    await waitFor(() => expect(page().getByRole("button", { name: "Continue" }).getAttribute("aria-busy")).toBe("true"));
    const amount = page().getByRole("textbox", { name: "Amount" }) as HTMLInputElement;
    expect(amount.readOnly).toBe(true);
    expect(amount.disabled).toBe(false);
    expect(amount.getAttribute("aria-readonly")).toBe("true");
    expect((page().getByRole("button", { name: "Max" }) as HTMLButtonElement).disabled).toBe(true);
    expect(page().queryByRole("combobox")).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Max" }));
    expect(amount.value).toBe("");
    expect(page().getByRole("button", { name: "Continue" }).getAttribute("aria-busy")).toBe("true");

    await act(async () => { release(resumedAction()); });
    expect(await page().findByRole("button", { name: "Send $1.00" })).toBeTruthy();
    expect(page().getByRole("dialog", { name: "Confirm" })).toBeTruthy();
  });
});
