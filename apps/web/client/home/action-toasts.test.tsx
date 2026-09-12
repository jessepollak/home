import "../account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { getHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import { activityOwnerKey } from "@/client/activity/use-activity";
import { announceActionFailure } from "./action-toast-events";

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { ActionToasts } = await import("./action-toasts");

const session: VerifiedAccountSession = {
  user: { subject: "toast-subject" },
  smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 },
  accountProvider: "cdp-embedded",
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
  owner: {
    subject: session.user.subject,
    address: session.smartAccount!.address,
    chainId: 8453,
    accountProvider: session.accountProvider,
  },
};

afterEach(() => {
  cleanup();
  getHomeQueryClient().clear();
});

describe("action toasts", () => {
  test("maps pending and confirmed actions to messages while the package owns dismissal", async () => {
    const view = render(
      <ActionToasts
        session={session}
        fetchOperations={async () => ({ actions: [row] })}
        dismissAfterMs={0}
      />,
    );

    await waitFor(() => expect(view.getByText("Sending $1.00 to 0x2222…222222")).toBeTruthy());
    expect(view.getByRole("region", { name: "Notifications" })).toBeTruthy();

    act(() => {
      getHomeQueryClient().setQueryData(
        ownerQueryKey(activityOwnerKey(session), "actions"),
        { actions: [{ ...row, status: "confirmed" }] },
      );
    });
    await waitFor(() => expect(view.getByText("Sent $1.00 to 0x2222…222222")).toBeTruthy());
    expect(view.getByText("Sending $1.00 to 0x2222…222222")).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "Dismiss Sending $1.00 to 0x2222…222222" }));
    expect(view.queryByText("Sending $1.00 to 0x2222…222222")).toBeNull();
    expect(view.getByText("Sent $1.00 to 0x2222…222222")).toBeTruthy();
  });

  test("maps action failure events to alert toasts", async () => {
    const view = render(
      <ActionToasts
        session={session}
        fetchOperations={async () => ({ actions: [] })}
        dismissAfterMs={0}
      />,
    );

    act(() => announceActionFailure("send", "Wallet unavailable"));
    const alert = await waitFor(() => view.getByRole("alert"));
    expect(alert.textContent).toContain("Send failed: Wallet unavailable");
  });
});
