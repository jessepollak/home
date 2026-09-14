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

    act(() => getHomeQueryClient().setQueryData(queryKey, { actions: [repayAll] }));
    await waitFor(() => expect(view.getByText("Repaying all Borrow debt")).toBeTruthy());
    expect(view.queryByText("Repaying $125.00")).toBeNull();

    act(() => getHomeQueryClient().setQueryData(queryKey, { actions: [{ ...repayAll, status: "confirmed" }] }));
    await waitFor(() => expect(view.getByText("Repaid all Borrow debt")).toBeTruthy());
    expect(view.queryByText("Repaid $125.00")).toBeNull();
  });

  test("uses position semantics for withdraw-all instead of suppressing its estimated receive amount", async () => {
    const queryKey = ownerQueryKey(activityOwnerKey(session), "actions");
    const withdrawAll = {
      ...row,
      id: "55555555-5555-4555-8555-555555555555",
      kind: "lend-withdraw",
      summary: {
        ...row.summary,
        metadata: { product: "lend", operation: "withdraw-all" },
        amounts: [
          { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "100000000", direction: "receive", estimated: true },
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

    act(() => getHomeQueryClient().setQueryData(queryKey, { actions: [withdrawAll] }));
    await waitFor(() => expect(view.getByText("Withdrawing all Lend supply")).toBeTruthy());
    expect(view.queryByText("Withdrawing $100.00 from Lend")).toBeNull();

    act(() => getHomeQueryClient().setQueryData(queryKey, { actions: [{ ...withdrawAll, status: "confirmed" }] }));
    await waitFor(() => expect(view.getByText("Withdrew all Lend supply")).toBeTruthy());
    expect(view.queryByText("Withdrew $100.00 from Lend")).toBeNull();
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

    act(() => getHomeQueryClient().setQueryData(queryKey, { actions: [closePosition] }));
    await waitFor(() => expect(view.getByText("Closing Borrow position")).toBeTruthy());
    expect(view.queryByText("Repaying $125.00")).toBeNull();

    act(() => getHomeQueryClient().setQueryData(queryKey, { actions: [{ ...closePosition, status: "confirmed" }] }));
    await waitFor(() => expect(view.getByText("Closed Borrow position")).toBeTruthy());
    expect(view.queryByText("Repaid $125.00")).toBeNull();
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

    await waitFor(() => expect(view.queryByRole("alert")).toBeNull());
  });
});
