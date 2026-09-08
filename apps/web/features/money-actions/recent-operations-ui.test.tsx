import "@/features/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";

const { cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const { RecentMoneyActions } = await import("./recent-operations");

const HASH = `0x${"a".repeat(64)}` as const;
const session = {
  user: { subject: "subject-a" },
  smartAccount: { address: "0x1111111111111111111111111111111111111111" as const, chainId: 8453 as const },
  accountProvider: "cdp-embedded" as const,
};

function operation(
  status: "prepared" | "submitted" | "submitting" | "unknown" | "confirmed",
  refs: { transactionHash?: typeof HASH | null } = {},
) {
  const transactionHash = refs.transactionHash === null
    ? undefined
    : refs.transactionHash ?? (status === "prepared" || status === "submitting" || status === "unknown"
      ? undefined
      : HASH);
  return {
    action: {
      id: "11111111-1111-4111-8111-111111111111",
      reviewHash: "b".repeat(64),
      owner: {
        subject: session.user.subject,
        address: session.smartAccount.address,
        chainId: 8453,
        accountProvider: session.accountProvider,
      },
      kind: "send",
      title: "Send USDC",
      calls: [{ to: "0x2222222222222222222222222222222222222222", data: "0x", value: "0" }],
      amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "spend" }],
      warnings: ["Network fee shown by wallet."],
      createdAt: "2026-09-08T05:00:00.000Z",
      expiresAt: "2026-09-08T05:10:00.000Z",
    },
    status,
    attemptCount: status === "prepared" ? 0 : 1,
    ...(transactionHash ? { transactionHash } : {}),
    createdAt: "2026-09-08T05:00:00.000Z",
    updatedAt: status === "confirmed" ? "2026-09-08T05:03:00.000Z" : "2026-09-08T05:02:00.000Z",
  };
}

afterEach(() => cleanup());

describe("RecentMoneyActions recovery", () => {
  test("reconciles only an already-claimed transaction and supports an explicit status retry", async () => {
    let reads = 0;
    render(
      <RecentMoneyActions
        session={session}
        fetchOperations={async () => ({ operations: [operation("submitted")] })}
        readOperation={async () => {
          reads += 1;
          return { operation: operation(reads === 1 ? "unknown" : "confirmed") };
        }}
      />,
    );

    await waitFor(() => expect(reads).toBe(1));
    const check = await within(document.body).findByRole("button", { name: "Check status" });
    fireEvent.click(check);
    await waitFor(() => expect(reads).toBe(2));
    await waitFor(() => expect(within(document.body).getByText(/Confirmed/)).toBeTruthy());
    expect(within(document.body).queryByRole("button", { name: "Check status" })).toBeNull();
  });

  test("keeps Check status on a claimed send with no submission refs and recovers without rebroadcasting", async () => {
    let recovers = 0;
    let reads = 0;
    const unresolved = operation("submitting");
    render(
      <RecentMoneyActions
        session={session}
        fetchOperations={async () => ({ operations: [unresolved] })}
        recoverOperation={async (action) => {
          recovers += 1;
          expect(action.id).toBe(unresolved.action.id);
          return { id: action.id, status: "unknown" };
        }}
        readOperation={async () => {
          reads += 1;
          return { operation: recovers === 0 ? unresolved : operation("unknown") };
        }}
      />,
    );

    const check = await within(document.body).findByRole("button", { name: "Check status" });
    expect(within(document.body).getByText(/Wallet submission unresolved/)).toBeTruthy();
    fireEvent.click(check);
    await waitFor(() => expect(recovers).toBe(1));
    await waitFor(() => expect(within(document.body).getByText(/Outcome unknown/)).toBeTruthy());
    expect(reads).toBeGreaterThan(0);
    expect(within(document.body).getByRole("button", { name: "Check status" })).toBeTruthy();
  });

  test("never background-claims or checks a merely prepared action", async () => {
    let reads = 0;
    render(
      <RecentMoneyActions
        session={session}
        fetchOperations={async () => ({ operations: [operation("prepared")] })}
        readOperation={async () => {
          reads += 1;
          return { operation: operation("prepared") };
        }}
      />,
    );

    await within(document.body).findByText(/Ready for review/);
    expect(reads).toBe(0);
    expect(within(document.body).queryByRole("button", { name: "Check status" })).toBeNull();
  });
});
