import "@/features/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import type { PreparedMoneyAction } from "./types";

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const {
  AccountWalletClientProvider,
  createBlockedAccountWalletClient,
} = await import("@/features/account/cdp-client");
const { MoneyActionReview } = await import("./review");

const action: PreparedMoneyAction = {
  id: "11111111-1111-4111-8111-111111111111",
  reviewHash: "a".repeat(64),
  owner: {
    subject: "subject-a",
    address: "0x1111111111111111111111111111111111111111",
    chainId: 8453,
    accountProvider: "cdp-embedded",
  },
  kind: "send",
  title: "Send ETH",
  calls: [{ to: "0x2222222222222222222222222222222222222222", data: "0x", value: "1" }],
  amounts: [{ assetId: "eth", symbol: "ETH", decimals: 18, amountBaseUnits: "100000000000000001", direction: "spend" }],
  warnings: ["Your wallet will show the Base network fee before you sign."],
  createdAt: "2026-09-07T01:00:00.000Z",
  expiresAt: "2026-09-07T01:10:00.000Z",
};

afterEach(cleanup);

describe("MoneyActionReview", () => {
  test("shows the full exact spend and lets an expired plan check status without signing a new plan", async () => {
    let checks = 0;
    let executions = 0;
    render(
      <MoneyActionReview
        action={action}
        onClose={() => {}}
        check={async () => {
          checks += 1;
          return { id: action.id, status: "expired" };
        }}
        execute={async () => {
          executions += 1;
          throw new Error("expired status checks must not execute");
        }}
        onConfirmed={() => {}}
      />,
    );

    expect(screen.getByText("0.100000000000000001 ETH")).toBeTruthy();
    expect(screen.getByText("Base network fees apply and are finalized at submission.")).toBeTruthy();
    expect(screen.queryByText(/wallet will show/i)).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("expired");
    fireEvent.click(screen.getByRole("button", { name: "Check action status" }));
    await waitFor(() => expect(checks).toBe(1));
    expect(executions).toBe(0);
  });

  test("keeps Check status after an unresolved execute and retries recover without a new prepare", async () => {
    const liveAction = { ...action, expiresAt: "2026-12-08T01:10:00.000Z" };
    let checks = 0;
    let executions = 0;
    render(
      <MoneyActionReview
        action={liveAction}
        onClose={() => {}}
        check={async () => {
          checks += 1;
          return { id: liveAction.id, status: "unknown" };
        }}
        execute={async () => {
          executions += 1;
          throw new Error("lost submission refs");
        }}
        onConfirmed={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm action" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/unresolved/));
    fireEvent.click(screen.getByRole("button", { name: "Check status" }));
    await waitFor(() => expect(checks).toBe(1));
    expect(executions).toBe(1);
    expect(screen.queryByRole("button", { name: "Confirm action" })).toBeNull();
  });

  test("preserves an execute-only injection and resolves only check from the wallet context", async () => {
    const liveAction = { ...action, expiresAt: "2026-12-08T01:10:00.000Z" };
    let suppliedExecutions = 0;
    let contextChecks = 0;
    let contextExecutions = 0;
    const client = {
      ...createBlockedAccountWalletClient("unconfigured"),
      checkMoneyAction: async () => {
        contextChecks += 1;
        return { id: liveAction.id, status: "unknown" } as const;
      },
      executeMoneyAction: async () => {
        contextExecutions += 1;
        return { id: liveAction.id, status: "unknown" } as const;
      },
    };

    render(
      <AccountWalletClientProvider client={client}>
        <MoneyActionReview
          action={liveAction}
          onClose={() => {}}
          execute={async () => {
            suppliedExecutions += 1;
            return { id: liveAction.id, status: "unknown" };
          }}
          onConfirmed={() => {}}
        />
      </AccountWalletClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm action" }));
    await waitFor(() => expect(suppliedExecutions).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "Check status" }));
    await waitFor(() => expect(contextChecks).toBe(1));
    expect(contextExecutions).toBe(0);
  });

  test("preserves a check-only injection and resolves only execute from the wallet context", async () => {
    const liveAction = { ...action, expiresAt: "2026-12-08T01:10:00.000Z" };
    let suppliedChecks = 0;
    let contextChecks = 0;
    let contextExecutions = 0;
    const client = {
      ...createBlockedAccountWalletClient("unconfigured"),
      checkMoneyAction: async () => {
        contextChecks += 1;
        return { id: liveAction.id, status: "unknown" } as const;
      },
      executeMoneyAction: async () => {
        contextExecutions += 1;
        return { id: liveAction.id, status: "unknown" } as const;
      },
    };

    render(
      <AccountWalletClientProvider client={client}>
        <MoneyActionReview
          action={liveAction}
          onClose={() => {}}
          check={async () => {
            suppliedChecks += 1;
            return { id: liveAction.id, status: "unknown" };
          }}
          onConfirmed={() => {}}
        />
      </AccountWalletClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm action" }));
    await waitFor(() => expect(contextExecutions).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "Check status" }));
    await waitFor(() => expect(suppliedChecks).toBe(1));
    expect(contextChecks).toBe(0);
  });

  test("reactively changes a mounted review to check-only when its deadline passes", async () => {
    const expiringAction = {
      ...action,
      expiresAt: new Date(Date.now() + 30).toISOString(),
    };
    let executions = 0;
    render(
      <MoneyActionReview
        action={expiringAction}
        onClose={() => {}}
        check={async () => ({ id: expiringAction.id, status: "prepared" })}
        execute={async () => {
          executions += 1;
          return { id: expiringAction.id, status: "unknown" };
        }}
        onConfirmed={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Confirm action" })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: "Check action status" })).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toMatch(/expired/);
    expect(executions).toBe(0);
  });

  test("does not present a terminally rejected action as a fresh confirm again", async () => {
    const liveAction = { ...action, expiresAt: "2026-12-08T01:10:00.000Z" };
    let executions = 0;
    render(
      <MoneyActionReview
        action={liveAction}
        onClose={() => {}}
        check={async () => ({ id: liveAction.id, status: "rejected" })}
        execute={async () => {
          executions += 1;
          return { id: liveAction.id, status: "rejected" };
        }}
        onConfirmed={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm action" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/rejected/));
    expect(screen.queryByRole("button", { name: "Confirm action" })).toBeNull();
    expect(screen.getByRole("button", { name: "Check status" })).toBeTruthy();
    expect(executions).toBe(1);
  });

  test("opens a recovering review on Check status instead of a second confirm", () => {
    const liveAction = { ...action, expiresAt: "2026-12-08T01:10:00.000Z" };
    render(
      <MoneyActionReview
        action={liveAction}
        recovering
        onClose={() => {}}
        check={async () => ({ id: liveAction.id, status: "unknown" })}
        execute={async () => ({ id: liveAction.id, status: "unknown" })}
        onConfirmed={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Check status" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm action" })).toBeNull();
    expect(screen.getByRole("alert").textContent).toMatch(/do not submit it again/);
  });

  test("labels a finite maximum spend as up to", () => {
    render(
      <MoneyActionReview
        action={{ ...action, amounts: [{ ...action.amounts[0], maximum: true }] }}
        onClose={() => {}}
        check={async () => ({ id: action.id, status: "unknown" })}
        execute={async () => ({ id: action.id, status: "unknown" })}
        onConfirmed={() => {}}
      />,
    );
    expect(screen.getByText("Up to")).toBeTruthy();
    expect(screen.getByText("0.100000000000000001 ETH")).toBeTruthy();
  });

  test("shows decoded approval token, spender, and exact base-unit cap", () => {
    const token = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
    const spender = "0x3333333333333333333333333333333333333333" as const;
    const cap = BigInt(1_000_000);
    render(
      <MoneyActionReview
        action={{
          ...action,
          calls: [{
            to: token,
            value: "0",
            data: `0x095ea7b3${spender.slice(2).padStart(64, "0")}${cap.toString(16).padStart(64, "0")}`,
            approval: { assetId: "usdc", spender },
          }],
        }}
        onClose={() => {}}
        check={async () => ({ id: action.id, status: "unknown" })}
        execute={async () => ({ id: action.id, status: "unknown" })}
        onConfirmed={() => {}}
      />,
    );

    expect(screen.getByText(new RegExp(`Token ${token}; spender ${spender}; cap 1000000 base units`))).toBeTruthy();
  });
});
