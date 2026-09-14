import "@/client/account/dom-test-harness";

import { getHomeQueryClient } from "@/client/query/query-client";
import { afterEach, describe, expect, test } from "bun:test";

const { cleanup, render, waitFor, within } = await import("@testing-library/react");
const { RecentMoneyActions } = await import("./recent-operations");

const HASH = `0x${"a".repeat(64)}` as const;
const session = {
  user: { subject: "subject-a" },
  smartAccount: { address: "0x1111111111111111111111111111111111111111" as const, chainId: 8453 as const },
  accountProvider: "cdp-embedded" as const,
};

function action(status: "pending" | "unknown" | "confirmed" | "failed", transactionHash?: string) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    owner: {
      subject: session.user.subject,
      address: session.smartAccount.address,
      accountProvider: session.accountProvider,
    },
    kind: "send",
    status,
    summary: {
      title: "Send USDC",
      amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "spend" }],
      warnings: ["Network fee shown by wallet."],
      expiresAt: "2026-09-12T05:10:00.000Z",
    },
    createdAt: "2026-09-12T05:00:00.000Z",
    confirmedAt: "2026-09-12T05:02:00.000Z",
    ...(transactionHash ? { transactionHash } : {}),
  };
}

afterEach(() => {
  cleanup();
  getHomeQueryClient().clear();
});

describe("RecentMoneyActions", () => {
  test("deduplicates a local action once indexed activity has its transaction hash", async () => {
    render(
      <RecentMoneyActions
        session={session}
        fetchOperations={async () => ({ actions: [action("confirmed", HASH)] })}
        excludeTransactionHashes={[HASH]}
      />,
    );

    await waitFor(() => expect(within(document.body).queryByText("Send USDC")).toBeNull());
  });

  test("does not render another owner's action", async () => {
    render(
      <RecentMoneyActions
        session={session}
        fetchOperations={async () => ({
          actions: [{ ...action("pending"), owner: { ...action("pending").owner, subject: "subject-b" } }],
        })}
      />,
    );

    await waitFor(() => expect(within(document.body).queryByText("Send USDC")).toBeNull());
  });

  test("announces when recorded actions are unavailable", async () => {
    render(
      <RecentMoneyActions
        session={session}
        fetchOperations={async () => {
          throw new Error("unavailable");
        }}
      />,
    );

    await waitFor(() => {
      expect(within(document.body).getByRole("status").textContent).toContain(
        "Recorded Home actions are unavailable",
      );
    });
  });
});
