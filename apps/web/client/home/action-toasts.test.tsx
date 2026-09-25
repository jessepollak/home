import "../account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { activityOwnerKey } from "@/client/activity/use-activity";
import { getHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import { announceActionFailure } from "./action-toast-events";
import { toast } from "@/components/ui/toast";

const { act, cleanup, render, waitFor } = await import("@testing-library/react");
const { ActionToasts } = await import("./action-toasts");

const session: VerifiedAccountSession = {
  user: { subject: "toast-subject" },
  smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 },
  accountProvider: "cdp-embedded",
};

const otherSession: VerifiedAccountSession = {
  ...session,
  user: { subject: "other-toast-subject" },
};

const row = {
  id: "11111111-1111-4111-8111-111111111111",
  provider: "cdp-embedded",
  kind: "send",
  summary: {
    title: "Send USDC",
    amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "spend" }],
    warnings: ["Recipient: 0x2222222222222222222222222222222222222222"],
    expiresAt: "2026-09-12T12:30:00.000Z",
  },
  status: "pending",
  createdAt: "2026-09-12T12:00:00.000Z",
  confirmedAt: "2026-09-12T12:01:00.000Z",
};

const progress = {
  version: 1, providerId: "peer", region: "US", depositId: "escrow-1", state: "awaiting-buyer",
  platform: "cashapp", platformLabel: "Cash App", amountAtomic: "50000000",
  filledAtomic: "0", returnedAtomic: "0", remainingAtomic: "50000000",
  withdrawable: true, withdrawing: false, etaSeconds: 3600, settledAt: null, updatedAt: "2026-09-12T12:01:00.000Z",
};
const cashout = {
  ...row,
  id: "55555555-5555-4555-8555-555555555555",
  kind: "cash-out",
  summary: {
    ...row.summary,
    warnings: [],
    amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "50000000", direction: "spend" }],
  },
  cashout: progress,
};
const withdrawal = {
  ...row,
  id: "66666666-6666-4666-8666-666666666666",
  kind: "cash-out-withdraw",
  summary: {
    ...row.summary,
    metadata: { product: "cashout", operation: "withdraw", depositId: "escrow-1" },
    warnings: [],
    amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "20000000", direction: "receive" }],
  },
};

afterEach(() => {
  toast.close();
  cleanup();
  getHomeQueryClient().clear();
});

function mount(initial: unknown[] = []) {
  const key = ownerQueryKey(activityOwnerKey(session), "actions");
  const view = render(
    <ActionToasts
      session={session}
      fetchOperations={async () => ({ actions: initial })}
      dismissAfterMs={0}
    />,
  );
  const update = (actions: unknown[]) => {
    void act(() => getHomeQueryClient().setQueryData(key, { actions }));
  };
  return { key, view, update };
}

describe("action toast owner fence", () => {
  test("shows new pending and confirmed send once after the first snapshot", async () => {
    const next = { ...row, id: "22222222-2222-4222-8222-222222222222" };
    const { key, view, update } = mount([row]);
    await waitFor(() => expect(getHomeQueryClient().getQueryData(key)).toBeTruthy());
    expect(view.queryByText("Sending $1.00 to 0x2222…222222")).toBeNull();
    update([row, next]);
    await waitFor(() => expect(view.getAllByText("Sending $1.00 to 0x2222…222222")).toHaveLength(1));
    update([row, { ...next, status: "confirmed" }]);
    await waitFor(() => expect(view.getAllByText("Sent $1.00 to 0x2222…222222")).toHaveLength(1));
  });

  test("does not narrate a repay cap as actually repaid", async () => {
    const repay = {
      ...row,
      kind: "repay",
      summary: {
        ...row.summary,
        metadata: { product: "borrow", operation: "repay-all" },
        amounts: [
          { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "100000000", direction: "spend", estimated: true },
          { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "125000000", direction: "spend", maximum: true },
        ],
        warnings: [],
      },
    };
    const { key, view, update } = mount();
    await waitFor(() => expect(getHomeQueryClient().getQueryData(key)).toBeTruthy());
    update([repay]);
    await waitFor(() => expect(view.getByText("Repaying all Borrow debt")).toBeTruthy());
    expect(view.queryByText("Repaying $125.00")).toBeNull();
    update([{ ...repay, status: "confirmed" }]);
    await waitFor(() => expect(view.getByText("Repaid all Borrow debt")).toBeTruthy());
    expect(view.queryByText("Repaid $125.00")).toBeNull();
  });

  test("names a position close without narrating its repay cap", async () => {
    const close = {
      ...row,
      kind: "repay",
      summary: { ...row.summary, metadata: { product: "borrow", operation: "close-position" }, warnings: [] },
    };
    const { key, view, update } = mount();
    await waitFor(() => expect(getHomeQueryClient().getQueryData(key)).toBeTruthy());
    update([close]);
    await waitFor(() => expect(view.getByText("Closing Borrow position")).toBeTruthy());
    update([{ ...close, status: "confirmed" }]);
    await waitFor(() => expect(view.getByText("Closed Borrow position")).toBeTruthy());
  });

  test("cash-out starts once, confirmation alone does not claim payout, and payout/return transitions toast", async () => {
    const { key, view, update } = mount();
    await waitFor(() => expect(getHomeQueryClient().getQueryData(key)).toBeTruthy());
    update([cashout]);
    await waitFor(() => expect(view.getByText("Cash-out started $50")).toBeTruthy());
    update([{ ...cashout, status: "confirmed" }]);
    expect(view.queryByText("Paid $50 to Cash App")).toBeNull();
    update([{
      ...cashout,
      status: "confirmed",
      cashout: { ...progress, state: "delivered", remainingAtomic: "0", filledAtomic: "50000000" },
    }]);
    await waitFor(() => expect(view.getByText("Paid $50 to Cash App")).toBeTruthy());
    update([{
      ...cashout,
      status: "confirmed",
      cashout: { ...progress, state: "returned", returnedAtomic: "50000000", remainingAtomic: "0" },
    }]);
    await waitFor(() => expect(view.getByText("Returned $50")).toBeTruthy());
  });

  test("withdrawal pending says returning; confirmation waits for folded deposit end state", async () => {
    const partial = { ...cashout, cashout: { ...progress, filledAtomic: "30000000", remainingAtomic: "20000000" } };
    const { key, view, update } = mount([partial]);
    await waitFor(() => expect(getHomeQueryClient().getQueryData(key)).toBeTruthy());
    update([{ ...partial, cashout: { ...partial.cashout, withdrawing: true } }, withdrawal]);
    await waitFor(() => expect(view.getByText("Returning $20")).toBeTruthy());
    update([partial, { ...withdrawal, status: "confirmed" }]);
    expect(view.queryByText("Paid $30 to Cash App · $20 returned")).toBeNull();
    const verified = { ...partial, cashout: { ...partial.cashout, returnedAtomic: "20000000" } };
    update([verified, { ...withdrawal, status: "confirmed" }]);
    await waitFor(() => expect(view.getByText("Paid $30 to Cash App · $20 returned")).toBeTruthy());
    expect(view.queryByText("Recovered $20")).toBeNull();
  });

  test("a newer failed withdrawal does not hide the earlier withdrawal that returns the money", async () => {
    const partial = { ...cashout, cashout: { ...progress, filledAtomic: "30000000", remainingAtomic: "20000000" } };
    const failed = { ...withdrawal, id: "77777777-7777-4777-8777-777777777777", status: "failed" };
    const { key, view, update } = mount([partial]);
    await waitFor(() => expect(getHomeQueryClient().getQueryData(key)).toBeTruthy());
    update([{ ...partial, cashout: { ...partial.cashout, withdrawing: true } }, failed, withdrawal]);
    await waitFor(() => expect(view.getByText("Returning $20")).toBeTruthy());
    const verified = { ...partial, cashout: { ...partial.cashout, returnedAtomic: "20000000" } };
    update([verified, failed, { ...withdrawal, status: "confirmed" }]);
    await waitFor(() => expect(view.getByText("Paid $30 to Cash App · $20 returned")).toBeTruthy());
  });

  test("folds mixed-case withdrawal deposit ID into lowercase cash-out toast stage", async () => {
    const partial = { ...cashout, cashout: {
      ...progress, depositId: "0x777777779d229cdf3110e9de47943791c26300ef_7",
      filledAtomic: "30000000", remainingAtomic: "20000000",
    } };
    const mixedWithdrawal = { ...withdrawal, summary: { ...withdrawal.summary, metadata: {
      ...withdrawal.summary.metadata, depositId: "0x777777779d229cdF3110e9de47943791c26300Ef_7",
    } } };
    const { key, view, update } = mount([partial]);
    await waitFor(() => expect(getHomeQueryClient().getQueryData(key)).toBeTruthy());
    update([{ ...partial, cashout: { ...partial.cashout, withdrawing: true } }, mixedWithdrawal]);
    await waitFor(() => expect(view.getByText("Returning $20")).toBeTruthy());
    update([{ ...partial, cashout: { ...partial.cashout, returnedAtomic: "20000000" } }, { ...mixedWithdrawal, status: "confirmed" }]);
    await waitFor(() => expect(view.getByText("Paid $30 to Cash App · $20 returned")).toBeTruthy());
    expect(view.queryByText("Recovered $20")).toBeNull();
  });

  test("names failure verbs for both Peer cash-out kinds", async () => {
    const { view } = mount();
    act(() => announceActionFailure("cash-out", "Wallet unavailable"));
    expect((await view.findByRole("alert")).textContent).toContain("Cash-out failed: Wallet unavailable");
    act(() => announceActionFailure("cash-out-withdraw", "Escrow unavailable"));
    await waitFor(() => expect(view.queryAllByText("Cash-out withdrawal failed: Escrow unavailable").length).toBeGreaterThan(0));
  });

  test("closes active toasts when the owner changes", async () => {
    const { view } = mount();
    act(() => announceActionFailure("send", "Wallet unavailable"));
    expect((await view.findByRole("alert")).textContent).toContain("Send failed: Wallet unavailable");
    view.rerender(
      <ActionToasts
        session={otherSession}
        fetchOperations={async () => ({ actions: [] })}
        dismissAfterMs={0}
      />,
    );
    await waitFor(() => expect(view.queryByRole("alert")).toBeNull(), { timeout: 2_000 });
  }, 15_000);
});
