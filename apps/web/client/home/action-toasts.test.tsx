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
