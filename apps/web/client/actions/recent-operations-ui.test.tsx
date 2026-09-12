import "@/client/account/dom-test-harness";

import { getHomeQueryClient } from "@/client/query/query-client";
import { afterEach, describe, expect, test } from "bun:test";

const { cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
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
  test("renders confirmed rows from GET /api/actions and opens read-only details", async () => {
    render(
      <RecentMoneyActions
        session={session}
        fetchOperations={async () => ({ actions: [action("confirmed", HASH)] })}
      />,
    );

    const row = await within(document.body).findByRole("button", { name: "View Send USDC transaction details" });
    expect(row.closest("li")?.textContent).toContain("Confirmed");
    fireEvent.click(row);
    expect(await within(document.body).findByRole("dialog", { name: "Send USDC" })).toBeTruthy();
    expect(within(document.body).getByRole("link", { name: /BaseScan/i })).toHaveProperty("href", `https://basescan.org/tx/${HASH}`);
  });

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
});
