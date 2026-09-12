import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { MoneyActionReview } = await import("./review");

const action: PreparedMoneyAction = {
  id: "11111111-1111-4111-8111-111111111111",
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
  createdAt: "2026-09-12T01:00:00.000Z",
  expiresAt: "2030-09-12T01:10:00.000Z",
};

afterEach(cleanup);

describe("MoneyActionReview", () => {
  test("shows the exact amount and confirms the server-authored action", async () => {
    let executions = 0;
    let confirmed = 0;
    render(
      <MoneyActionReview
        action={action}
        onClose={() => {}}
        execute={async () => {
          executions += 1;
          return { id: action.id, status: "submitted" };
        }}
        onConfirmed={() => { confirmed += 1; }}
      />,
    );

    expect(screen.getByText("0.100000000000000001 ETH")).toBeTruthy();
    expect(screen.getByText("Base network fees apply and are finalized at submission.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm action" }));
    await waitFor(() => expect(confirmed).toBe(1));
    expect(executions).toBe(1);
  });

  test("offers a same-action retry after an unresolved dispatch", async () => {
    let executions = 0;
    render(
      <MoneyActionReview
        action={action}
        onClose={() => {}}
        execute={async () => {
          executions += 1;
          if (executions === 1) throw new Error("ambiguous handle response");
          return { id: action.id, status: "submitted" };
        }}
        onConfirmed={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm action" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("same action");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(executions).toBe(2));
  });

  test("does not dispatch an expired unconfirmed action", () => {
    let executions = 0;
    render(
      <MoneyActionReview
        action={{ ...action, expiresAt: "2026-09-11T01:10:00.000Z" }}
        onClose={() => {}}
        execute={async () => {
          executions += 1;
          return { id: action.id, status: "submitted" };
        }}
        onConfirmed={() => {}}
      />,
    );
    expect((screen.getByRole("button", { name: "Confirm action" }) as HTMLButtonElement).disabled).toBe(true);
    expect(executions).toBe(0);
  });

  test("keeps raw call targets and base-unit approval caps off the confirm step", () => {
    render(
      <MoneyActionReview
        action={action}
        onClose={() => {}}
        execute={async () => ({ id: action.id, status: "submitted" })}
        onConfirmed={() => {}}
      />,
    );

    expect(screen.queryByText(/0x2222/i)).toBeNull();
    expect(screen.queryByText(/base units/i)).toBeNull();
    expect(screen.getByText("Base (8453)")).toBeTruthy();
  });
});
