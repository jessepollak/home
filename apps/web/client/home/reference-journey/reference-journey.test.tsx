import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { getHomeQueryClient } from "@/client/query/query-client";
import { afterEach, describe, expect, test } from "bun:test";
import type { OperationResult } from "@/shared/money-actions/types";
import {
  referenceActivity,
  referenceExecuteMoneyAction,
  referenceFundedPosition,
  referencePrepareMoneyAction,
  referenceSession,
  referenceVaultMetadata,
} from "./reference-fixtures";

const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { ReferenceJourney } = await import("./reference-journey");

afterEach(() => {
  cleanup();
  getHomeQueryClient().clear();
});

function text(): string {
  return document.body.textContent ?? "";
}

function typeAmount(digits: string) {
  for (const digit of digits) {
    fireEvent.click(page().getByRole("button", { name: digit }));
  }
}

function renderJourney(overrides: {
  executeMoneyAction?: Parameters<typeof ReferenceJourney>[0]["executeMoneyAction"];
} = {}) {
  return render(
    <ReferenceJourney
      initialPosition={referenceFundedPosition}
      session={referenceSession}
      activity={referenceActivity()}
      prepareMoneyAction={referencePrepareMoneyAction(referenceVaultMetadata)}
      executeMoneyAction={overrides.executeMoneyAction ?? referenceExecuteMoneyAction("confirmed")}
    />,
  );
}

function openSave() {
  fireEvent.click(page().getByRole("button", { name: /Gauntlet USDC Prime/ }));
}

function openDepositAndReview() {
  fireEvent.click(page().getByRole("button", { name: /^Deposit to / }));
  typeAmount("25");
  fireEvent.click(page().getByRole("button", { name: "Continue" }));
}

describe("ReferenceJourney", () => {
  test("moves an exact deposit from cash into Save and returns with the net position unchanged", async () => {
    renderJourney();

    expect(text()).toContain("Net position");
    expect(text()).toContain("$1,250.00");
    expect(text()).toContain("Available to use $250.00");
    expect(text()).toContain("Gauntlet USDC Prime");
    expect(text()).toContain("4.04% APY");

    openSave();
    expect(text()).toContain("Saved");
    expect(text()).toContain("$1,000.00");
    expect(text()).toContain("Earning ~4.04%");
    expect(text()).toContain("Steakhouse USDC");

    openDepositAndReview();
    const confirmButton = await page().findByRole("button", { name: "Deposit $25.00" });
    expect(text()).toContain("Deposit to Save");
    expect(text()).toContain("$25.00");
    expect(text()).toContain("Base (8453)");

    fireEvent.click(confirmButton);
    await page().findByText(/Fixture only — deposit simulated/);
    expect(text()).toContain("Fixture only — deposit simulated.");
    expect(text()).toContain("Cash $225.00");
    expect(text()).toContain("Saved $1,025.00");
    expect(text()).toContain("Net position $1,250.00 unchanged.");

    fireEvent.click(page().getByRole("button", { name: "Back" }));
    expect(text()).toContain("$225.00");
    expect(text()).toContain("$1,025.00");
    expect(text()).toContain("$1,250.00");
    expect(text()).toContain("Deposit USDC");
    expect(text()).toContain("Confirmed");
  });

  test("keeps the amount, blocks dismissal, and stays recoverable when the fixture dispatch fails", async () => {
    renderJourney({ executeMoneyAction: referenceExecuteMoneyAction("failed") });
    openSave();
    openDepositAndReview();

    fireEvent.click(await page().findByRole("button", { name: "Deposit $25.00" }));
    const alert = await page().findByRole("alert");
    expect(alert.textContent).toContain("did not succeed onchain");
    expect(text()).not.toContain("Fixture only");
    expect(text()).toContain("$1,000.00");

    const backButtons = page().getAllByRole("button", { name: "Back" });
    const back = backButtons.at(-1) as HTMLButtonElement;
    expect(back.disabled).toBe(false);
    fireEvent.click(back);
    expect(await page().findByRole("dialog", { name: "Deposit" })).toBeTruthy();
    expect(text()).toContain("25");
    expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    expect(await page().findByRole("button", { name: "Deposit $25.00" })).toBeTruthy();
  });

  test("records a submitted fixture deposit without moving balances", async () => {
    renderJourney({ executeMoneyAction: async (action) => ({ id: action.id, status: "submitted" }) });
    openSave();
    openDepositAndReview();

    fireEvent.click(await page().findByRole("button", { name: "Deposit $25.00" }));
    await page().findByText(/deposit submitted; balances stay unchanged until it confirms/);
    expect(text()).toContain("$1,000.00");
    expect(text()).toContain("$250.00");
    expect(text()).not.toContain("deposit simulated");
  });

  test("holds a pending fixture action open until the wallet result resolves", async () => {
    let release!: (result: OperationResult) => void;
    const pending = new Promise<OperationResult>((resolve) => {
      release = resolve;
    });
    renderJourney({ executeMoneyAction: () => pending });
    openSave();
    openDepositAndReview();

    fireEvent.click(await page().findByRole("button", { name: "Deposit $25.00" }));
    await page().findByText("Waiting for your wallet…");
    const closeButton = page().getByRole("button", { name: "Close deposit dialog" }) as HTMLButtonElement;
    expect(closeButton.disabled).toBe(true);
    fireEvent.click(closeButton);
    expect(page().getByText("Waiting for your wallet…")).toBeTruthy();

    release({ id: "reference-pending", status: "rejected" });
    const alert = await page().findByRole("alert");
    expect(alert.textContent).toContain("wallet request was rejected");
  });

  test("labels unmapped reference intents instead of opening a provider flow", () => {
    renderJourney();

    fireEvent.click(page().getByRole("button", { name: "Add money" }));
    expect(text()).toContain("Reference intent — Add money keeps its existing production flow.");
    expect(page().queryByRole("dialog")).toBeNull();

    fireEvent.click(page().getByRole("button", { name: "Cash out" }));
    expect(text()).toContain("Reference intent — Cash out keeps its existing production flow.");

    fireEvent.click(page().getByRole("button", { name: "Invest" }));
    expect(text()).toContain("Reference intent — Invest keeps its existing production flow.");
    expect(page().queryByRole("dialog")).toBeNull();
  });

  test("opens Activity transaction details and returns to the list", async () => {
    renderJourney();

    fireEvent.click(page().getByRole("button", { name: "Activity" }));
    expect(text()).toContain("Received");
    expect(text()).toContain("Sent");
    expect(text()).toContain("End of activity");

    fireEvent.click(page().getByRole("button", { name: /^Received .*250\.00 USDC$/ }));
    const details = await page().findByRole("dialog", { name: "Received USDC" });
    expect(details.textContent).toContain("Amount");
    expect(details.textContent).toContain("+250 USDC");
    expect(details.textContent).toContain("From");
    expect(details.textContent).toContain("Status");
    expect(details.textContent).toContain("Confirmed");

    fireEvent.click(page().getByRole("button", { name: "Close transaction details" }));
    await waitFor(() => expect(page().queryByRole("dialog", { name: "Received USDC" })).toBeNull());
    expect(text()).toContain("Received");
  });
});
