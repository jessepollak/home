import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { getHomeQueryClient } from "@/client/query/query-client";
import { afterEach, describe, expect, test } from "bun:test";
import {
  REIMAGINED_VAULT_ADDRESSES,
  reimaginedFailedState,
  reimaginedFundedState,
  reimaginedLoadingState,
  reimaginedMoveExecutor,
  reimaginedSavedUnavailableState,
} from "./fixtures";
import type { MoveMoneyExecutor } from "./move-money";
import type { MoveMoneyOutcome } from "./money-state";
import { MoneyDesk } from "./money-desk";
import { MoneyJournal } from "./money-journal";
import { MoneyMap } from "./money-map";
import { OneHome } from "./one-home";

/**
 * Move-money interaction tests for the Home reimagined exploration
 * ([issue #662](https://github.com/jessepollak/home/issues/662)).
 *
 * They drive the shared flow through a real direction: amount → review → pending → result,
 * with exact facts, a deliberate destination choice, validation, Back/Cancel, and the rule
 * that only a confirmed outcome changes balances.
 */

const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");

afterEach(() => {
  cleanup();
  getHomeQueryClient().clear();
});

function text(): string {
  return document.body.textContent ?? "";
}

function gauntletChooseButton() {
  return page().getByRole("button", { name: "Choose Gauntlet USDC Core vault" });
}

function renderMap(execute: MoveMoneyExecutor = reimaginedMoveExecutor("confirmed")) {
  return render(
    <MoneyMap
      initialState={reimaginedFundedState()}
      initialScreen="move"
      initialFlow={{ step: "destination" }}
      executeMove={execute}
    />,
  );
}

async function reachReview(amount = "100") {
  fireEvent.click(gauntletChooseButton());
  fireEvent.click(page().getByRole("button", { name: "Continue" }));
  fireEvent.input(page().getByLabelText("Amount"), { target: { value: amount } });
  fireEvent.click(page().getByRole("button", { name: "Review deposit" }));
  return page().findByRole("button", { name: `Deposit $${amount}.00` });
}

describe("move money flow", () => {
  test("moves an exact amount from available cash into the chosen vault, and only on confirmation", async () => {
    renderMap();

    expect(text()).toContain("Where should this go?");
    expect(text()).toContain("$750.00 saved");
    expect(text()).toContain("4.10% APY");

    const confirm = await reachReview("100");
    expect(text()).toContain("Check this deposit");
    expect(text()).toContain("Available to use $250.00");
    expect(text()).toContain("Gauntlet USDC Core vault");
    expect(text()).toContain("Base (8453)");

    fireEvent.click(confirm);
    await page().findByText("Deposited $100.00");
    expect(text()).toContain("Your cash is now saved in Gauntlet USDC Core vault.");
    expect(text()).toContain("Available to use now");
    expect(text()).toContain("$150.00");
    expect(text()).toContain("Saved now");
    expect(text()).toContain("$1,100.00");
    expect(text()).toContain("$1,250.00");
    expect(page().queryByText("$250.00")).toBeNull();

    fireEvent.click(page().getByRole("button", { name: "Back to money" }));
    expect(page().queryByLabelText("Net position $1,250.00")).not.toBeNull();
    expect(page().queryByLabelText("Available to use $150.00")).not.toBeNull();
    expect(text()).toContain("$1,100.00 in 2 vaults");
  });

  test("shows the pending step before the outcome arrives and never renders it as done", async () => {
    const deferredOutcome: { resolve: ((outcome: MoveMoneyOutcome) => void) | null } = {
      resolve: null,
    };
    const deferred: MoveMoneyExecutor = () =>
      new Promise<MoveMoneyOutcome>((resolve) => {
        deferredOutcome.resolve = resolve;
      });
    renderMap(deferred);

    const confirm = await reachReview("100");
    fireEvent.click(confirm);

    expect(text()).toContain("Deposit submitted");
    expect(text()).toContain("Waiting for Base to confirm. Nothing has moved yet.");
    expect(text()).toContain("$250.00 · not moved");

    if (!deferredOutcome.resolve) throw new Error("The deferred executor never ran.");
    deferredOutcome.resolve({ status: "confirmed" });
    await page().findByText("Deposited $100.00");
  });

  test("a pending outcome stays pending: balances do not move", async () => {
    renderMap(reimaginedMoveExecutor("pending"));

    const confirm = await reachReview("100");
    fireEvent.click(confirm);

    await page().findByText("Deposit submitted");
    expect(page().getByText("Pending")).toBeDefined();
    expect(text()).toContain("Available to use now");
    expect(text()).toContain("$250.00");
    expect(text()).toContain("$1,000.00");
    expect(text()).not.toContain("$150.00");
  });

  test("an unknown outcome offers no retry and says to check Activity first", async () => {
    renderMap(reimaginedMoveExecutor("unknown"));

    const confirm = await reachReview("100");
    fireEvent.click(confirm);

    await page().findByText("We couldn't confirm this deposit");
    expect(text()).toContain("Check Activity before sending anything again.");
    expect(page().queryByRole("button", { name: "Try again" })).toBeNull();
    expect(page().getByRole("button", { name: "Check Activity" })).toBeDefined();
  });

  test("a failed outcome returns to the amount step on request without resubmitting", async () => {
    renderMap(reimaginedMoveExecutor("failed"));

    const confirm = await reachReview("100");
    fireEvent.click(confirm);
    await page().findByText("The deposit didn't go through");
    expect(text()).toContain("No money moved.");

    fireEvent.click(page().getByRole("button", { name: "Try again" }));
    const amountInput = page().getByLabelText("Amount") as HTMLInputElement;
    expect(amountInput.value).toBe("100");
    expect(text()).toContain("$250.00");
    expect(text()).toContain("How much are you moving?");
    expect(text()).not.toContain("Check this deposit");
  });

  test("refuses an amount above available to use and explains the exact limit", () => {
    renderMap(reimaginedMoveExecutor("confirmed"));
    fireEvent.click(gauntletChooseButton());
    fireEvent.click(page().getByRole("button", { name: "Continue" }));

    fireEvent.input(page().getByLabelText("Amount"), { target: { value: "300" } });
    fireEvent.click(page().getByRole("button", { name: "Review deposit" }));

    expect(text()).toContain("You can move up to $250.00.");
    expect(text()).not.toContain("Check this deposit");
  });

  test("refuses a fractional amount beyond six decimals", () => {
    renderMap(reimaginedMoveExecutor("confirmed"));
    fireEvent.click(gauntletChooseButton());
    fireEvent.click(page().getByRole("button", { name: "Continue" }));

    fireEvent.input(page().getByLabelText("Amount"), { target: { value: "1.1234567" } });
    fireEvent.click(page().getByRole("button", { name: "Review deposit" }));

    expect(text()).toContain("at most 6 decimal places");
  });

  test("Back from review returns to the amount step with the typed amount intact", async () => {
    renderMap(reimaginedMoveExecutor("confirmed"));
    await reachReview("100");

    fireEvent.click(page().getByRole("button", { name: "Back" }));
    const amountInput = page().getByLabelText("Amount") as HTMLInputElement;
    expect(amountInput.value).toBe("100");
    expect(text()).toContain("How much are you moving?");
  });

  test("Cancel before choosing a destination records nothing", () => {
    renderMap(reimaginedMoveExecutor("confirmed"));

    fireEvent.click(page().getByRole("button", { name: "Cancel" }));

    expect(page().queryByLabelText("Net position $1,250.00")).not.toBeNull();
    expect(page().queryByLabelText("Available to use $250.00")).not.toBeNull();
    expect(text()).not.toContain("still settling");
    expect(text()).not.toContain("Deposit submitted");
  });

  test("Money Desk keeps the destination inline and shows the step rail through review", async () => {
    render(
      <MoneyDesk
        initialState={reimaginedFundedState()}
        initialTab="move"
        initialFlow={{ step: "amount" }}
        executeMove={reimaginedMoveExecutor("confirmed")}
      />,
    );

    expect(text()).toContain("Deposit amount");
    expect(page().queryByText("Where should this go?")).toBeNull();
    expect(text()).toContain("Nothing is selected for you");

    fireEvent.click(gauntletChooseButton());
    fireEvent.input(page().getByLabelText("Amount to deposit"), { target: { value: "100" } });
    fireEvent.click(page().getByRole("button", { name: "Review" }));

    await page().findByRole("button", { name: "Confirm deposit $100.00" });
    expect(text()).toContain("Review the deposit");
    expect(text()).toContain("1. Amount");
    expect(text()).toContain("2. Review");
    expect(text()).toContain("3. Result");
  });

  test("a loading Money Map loads its rows and keeps the action pair, neither available", () => {
    render(<MoneyMap initialState={reimaginedLoadingState()} />);

    // Loading is a state of its own: it never reads as unavailable, and it never swaps the
    // funded actions for an unfunded call to action.
    expect(text()).not.toContain("Unavailable");
    expect(text()).not.toContain("Incomplete");
    expect(page().getByRole("button", { name: "Move money" }).hasAttribute("disabled")).toBe(true);
    expect(page().getByRole("button", { name: "Add money" }).hasAttribute("disabled")).toBe(true);
    expect(text()).toContain("Net position");
  });

  test("an empty amount is refused with an answer and puts focus back in the field", () => {
    renderMap(reimaginedMoveExecutor("confirmed"));
    fireEvent.click(gauntletChooseButton());
    fireEvent.click(page().getByRole("button", { name: "Continue" }));

    fireEvent.click(page().getByRole("button", { name: "Review deposit" }));

    expect(text()).toContain("Enter an amount to continue.");
    expect(text()).not.toContain("Check this deposit");
    expect(document.activeElement).toBe(page().getByLabelText("Amount"));
  });

  test("Money Map disables the deposit when no vault can be chosen", () => {
    render(<MoneyMap initialState={reimaginedSavedUnavailableState()} />);

    expect(page().getByRole("button", { name: "Move money" }).hasAttribute("disabled")).toBe(true);
  });

  test("a move flow without a vault list says so instead of rendering an empty choice", () => {
    render(
      <MoneyMap
        initialState={reimaginedSavedUnavailableState()}
        initialScreen="move"
        initialFlow={{ step: "destination" }}
        executeMove={reimaginedMoveExecutor("confirmed")}
      />,
    );

    expect(text()).toContain("Vault list is unavailable right now");
    expect(page().queryByRole("button", { name: "Continue" })).toBeNull();
    expect(text()).toContain("Vault list is unavailable right now");
  });

  test("the journal receipt reports time, reference, status, and resulting balances", async () => {
    render(
      <MoneyJournal
        initialState={reimaginedFundedState()}
        initialScreen="move"
        initialFlow={{
          step: "review",
          destinationId: REIMAGINED_VAULT_ADDRESSES.gauntlet,
          amountText: "100",
        }}
        executeMove={reimaginedMoveExecutor("confirmed")}
      />,
    );

    fireEvent.click(page().getByRole("button", { name: "Submit $100.00 entry" }));
    await page().findByRole("heading", { name: "Entry recorded: $100.00" });

    expect(text()).toContain("Receipt");
    expect(text()).toContain("Time");
    expect(text()).toContain("Reference");
    // The confirmed fixture carries the recorded transaction, so the receipt names it.
    expect(text()).toContain("0xcdcdcdcd…cdcdcdcd");
    expect(text()).toContain("Status");
    expect(text()).toContain("Confirmed");
    expect(text()).toContain("Resulting balances");
    expect(text()).toContain("$150.00");
    expect(text()).toContain("$1,100.00");

    // The closing action is a decision, so it sits outside the status region.
    const done = page().getByRole("button", { name: "Back to journal" });
    expect(done.closest('[role="status"]')).toBeNull();
    // The receipt states the status once, in its own Status line.
    expect(page().queryByText("Confirmed", { selector: "span" })).toBeNull();
  });

  test("the Activity retry opens the prefilled workspace and a confirmed retry clears the notice", async () => {
    render(
      <MoneyMap
        initialState={reimaginedFailedState()}
        initialTab="activity"
        executeMove={reimaginedMoveExecutor("confirmed")}
      />,
    );

    expect(text()).toContain("A $100.00 deposit didn't go through");
    fireEvent.click(page().getByRole("button", { name: "Try again" }));

    // The workspace lives in the Money tab, so the retry has to arrive there with the exact
    // vault and amount already in place.
    expect(page().getByRole("heading", { name: "Move money" })).toBeDefined();
    const prefilled = page().getByLabelText("Amount") as HTMLInputElement;
    expect(prefilled.value).toBe("100");
    expect(text()).toContain("Into Gauntlet USDC Core vault");

    fireEvent.click(page().getByRole("button", { name: "Review deposit" }));
    fireEvent.click(page().getByRole("button", { name: "Deposit $100.00" }));
    await page().findByRole("heading", { name: "Deposited $100.00" });
    expect(text()).toContain("Available to use now");
    expect(text()).toContain("$150.00");

    fireEvent.click(page().getByRole("button", { name: "Done" }));
    // The failure it superseded no longer drives the notice, and the money it moved is gone
    // from available to use.
    expect(text()).not.toContain("didn't go through");
    expect(page().queryByLabelText("Available to use $150.00")).not.toBeNull();

    fireEvent.click(page().getByRole("button", { name: "Activity" }));
    expect(text()).toContain("Deposit to Gauntlet USDC Core vault failed");
    expect(text()).toContain("Saved to Gauntlet USDC Core vault");
    expect(page().getByText("Failed")).toBeDefined();
  });

  test("the Money Map loading overview declares itself busy and announces the wait", () => {
    render(<MoneyMap initialState={reimaginedLoadingState()} />);

    expect(text()).toContain("Loading your money position…");
    const busy = document.querySelector('[aria-busy="true"]');
    expect(busy).not.toBeNull();
    expect(busy?.textContent).toContain("Loading your money position…");
  });

  test("One Home moves money in a page takeover and returns to the chapters", async () => {
    render(
      <OneHome
        initialState={reimaginedFundedState()}
        initialView="move"
        initialFlow={{
          step: "review",
          destinationId: REIMAGINED_VAULT_ADDRESSES.gauntlet,
          amountText: "100",
        }}
        executeMove={reimaginedMoveExecutor("confirmed")}
      />,
    );

    expect(text()).toContain("Move money");
    fireEvent.click(page().getByRole("button", { name: "Deposit $100.00" }));
    await page().findByText("Deposited $100.00");

    fireEvent.click(page().getByRole("button", { name: "Back to home" }));
    expect(page().getByRole("navigation", { name: "Jump to chapter" })).toBeDefined();
    expect(text()).toContain("Position");
    await waitFor(() => expect(text()).toContain("$150.00"));
    expect(text()).toContain("$1,100.00");
    expect(text()).toContain("$850.00 saved");
  });
});
