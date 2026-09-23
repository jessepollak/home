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

afterEach(() => {
  toast.close();
  cleanup();
  getHomeQueryClient().clear();
});

describe("action toast owner fence", () => {
  test("shows new pending and pending to confirmed status transitions once after the first snapshot", async () => {
    const queryKey = ownerQueryKey(activityOwnerKey(session), "actions");
    const nextRow = { ...row, id: "22222222-2222-4222-8222-222222222222" };
    const view = render(
      <ActionToasts
        session={session}
        fetchOperations={async () => ({ actions: [row] })}
        dismissAfterMs={0}
      />,
    );

    await waitFor(() => expect(getHomeQueryClient().getQueryData(queryKey)).toBeTruthy());
    expect(view.queryByText("Sending $1.00 to 0x2222…222222")).toBeNull();

    act(() => {
      getHomeQueryClient().setQueryData(queryKey, { actions: [row, nextRow] });
    });
    await waitFor(() => expect(view.getAllByText("Sending $1.00 to 0x2222…222222")).toHaveLength(1));

    act(() => {
      getHomeQueryClient().setQueryData(
        queryKey,
        { actions: [row, { ...nextRow, status: "confirmed" }] },
      );
    });
    await waitFor(() => expect(view.getAllByText("Sent $1.00 to 0x2222…222222")).toHaveLength(1));
  });

  test("never presents a repay-all cap as the amount actually repaid", async () => {
    const queryKey = ownerQueryKey(activityOwnerKey(session), "actions");
    const repayAll = {
      ...row,
      id: "33333333-3333-4333-8333-333333333333",
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
    const view = render(
      <ActionToasts
        session={session}
        fetchOperations={async () => ({ actions: [] })}
        dismissAfterMs={0}
      />,
    );
    await waitFor(() => expect(getHomeQueryClient().getQueryData(queryKey)).toBeTruthy());

    void act(() => getHomeQueryClient().setQueryData(queryKey, { actions: [repayAll] }));
    await waitFor(() => expect(view.getByText("Repaying all Borrow debt")).toBeTruthy());
    expect(view.queryByText("Repaying $125.00")).toBeNull();

    void act(() => getHomeQueryClient().setQueryData(queryKey, { actions: [{ ...repayAll, status: "confirmed" }] }));
    await waitFor(() => expect(view.getByText("Repaid all Borrow debt")).toBeTruthy());
    expect(view.queryByText("Repaid $125.00")).toBeNull();
  });

  test("uses position semantics for close instead of displaying its repay cap", async () => {
    const queryKey = ownerQueryKey(activityOwnerKey(session), "actions");
    const closePosition = {
      ...row,
      id: "44444444-4444-4444-8444-444444444444",
      kind: "repay",
      summary: {
        ...row.summary,
        metadata: { product: "borrow", operation: "close-position" },
        amounts: [
          { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "100000000", direction: "spend", estimated: true },
          { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "125000000", direction: "spend", maximum: true },
          { assetId: "cbbtc", symbol: "cbBTC", decimals: 8, amountBaseUnits: "100000000", direction: "receive" },
        ],
        warnings: [],
      },
    };
    const view = render(
      <ActionToasts
        session={session}
        fetchOperations={async () => ({ actions: [] })}
        dismissAfterMs={0}
      />,
    );
    await waitFor(() => expect(getHomeQueryClient().getQueryData(queryKey)).toBeTruthy());

    void act(() => getHomeQueryClient().setQueryData(queryKey, { actions: [closePosition] }));
    await waitFor(() => expect(view.getByText("Closing Borrow position")).toBeTruthy());
    expect(view.queryByText("Repaying $125.00")).toBeNull();

    void act(() => getHomeQueryClient().setQueryData(queryKey, { actions: [{ ...closePosition, status: "confirmed" }] }));
    await waitFor(() => expect(view.getByText("Closed Borrow position")).toBeTruthy());
    expect(view.queryByText("Repaid $125.00")).toBeNull();
  });

  test("narrates a Peer cash-out spend and its recovery receive amounts", async () => {
    const queryKey = ownerQueryKey(activityOwnerKey(session), "actions");
    const cashOut = {
      ...row,
      id: "55555555-5555-4555-8555-555555555555",
      kind: "cash-out",
      summary: {
        ...row.summary,
        amounts: [
          { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "100000", direction: "spend" },
        ],
        warnings: [],
      },
    };
    const withdrawal = {
      ...cashOut,
      id: "66666666-6666-4666-8666-666666666666",
      kind: "cash-out-withdraw",
      summary: {
        ...cashOut.summary,
        amounts: [
          { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "100000", direction: "receive" },
        ],
      },
    };
    const view = render(
      <ActionToasts
        session={session}
        fetchOperations={async () => ({ actions: [] })}
        dismissAfterMs={0}
      />,
    );
    await waitFor(() => expect(getHomeQueryClient().getQueryData(queryKey)).toBeTruthy());

    void act(() => getHomeQueryClient().setQueryData(queryKey, { actions: [cashOut] }));
    await waitFor(() => expect(view.getByText("Cashing out $0.10")).toBeTruthy());
    expect(view.queryByText("Cashing out 0.1 USDC")).toBeNull();

    void act(() => getHomeQueryClient().setQueryData(queryKey, { actions: [{ ...cashOut, status: "confirmed" }] }));
    await waitFor(() => expect(view.getByText("Cashed out $0.10")).toBeTruthy());

    void act(() => getHomeQueryClient().setQueryData(queryKey, { actions: [{ ...withdrawal, status: "pending" }] }));
    await waitFor(() => expect(view.getByText("Recovering $0.10")).toBeTruthy());

    void act(() => getHomeQueryClient().setQueryData(queryKey, { actions: [{ ...withdrawal, status: "confirmed" }] }));
    await waitFor(() => expect(view.getByText("Recovered $0.10")).toBeTruthy());
  });

  test("names the failure verb for both Peer cash-out kinds", async () => {
    const view = render(
      <ActionToasts
        session={session}
        fetchOperations={async () => ({ actions: [] })}
        dismissAfterMs={0}
      />,
    );

    act(() => announceActionFailure("cash-out", "Wallet unavailable"));
    expect((await view.findByRole("alert")).textContent).toContain("Cash-out failed: Wallet unavailable");

    act(() => announceActionFailure("cash-out-withdraw", "Escrow unavailable"));
    await waitFor(() => expect(
      view.queryAllByText("Cash-out withdrawal failed: Escrow unavailable").length,
    ).toBeGreaterThan(0));
  });

  test("closes all active toasts when the owner boundary changes", async () => {
    const view = render(
      <ActionToasts
        session={session}
        fetchOperations={async () => ({ actions: [] })}
        dismissAfterMs={0}
      />,
    );

    act(() => announceActionFailure("send", "Wallet unavailable"));
    expect((await view.findByRole("alert")).textContent).toContain("Send failed: Wallet unavailable");

    view.rerender(
      <ActionToasts
        session={otherSession}
        fetchOperations={async () => ({ actions: [] })}
        dismissAfterMs={0}
      />,
    );

    // Base UI's toast exit waits on a transition fallback (~1.5s under happy-dom).
    await waitFor(() => expect(view.queryByRole("alert")).toBeNull(), { timeout: 2_000 });
  }, 15_000);
});
