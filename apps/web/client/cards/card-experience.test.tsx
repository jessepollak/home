import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, jest, test } from "bun:test";
import type { CardState } from "@/shared/cards/contract";
import { cardsBody } from "@/tests/browser/fixtures/bodies";

const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { CardScreen } = await import("./card-experience");
const { stripePublishableKey } = await import("./card-reveal");

afterEach(cleanup);

function renderScreen(state: CardState | "loading" | "failed", overrides: Partial<Parameters<typeof CardScreen>[0]> = {}) {
  const commands = {
    enroll: jest.fn(async () => "https://bridge.withpersona.com/verify?inquiry-template-id=itmpl_test"),
    issue: jest.fn(async () => {}),
    setFrozen: jest.fn(async () => {}),
  };
  const onRetry = jest.fn();
  const onOpenVerification = jest.fn();
  const cards = state === "loading" || state === "failed" ? { status: state } as const : { status: "ready", response: cardsBody(state) } as const;
  const view = render(<CardScreen cards={cards} commands={commands} onRetry={onRetry} onOpenVerification={onOpenVerification} {...overrides} />);
  return { view, commands, onRetry, onOpenVerification };
}

const reveal = { publishableKey: "pk_test_fixture", revealKey: async () => { throw new Error("not used"); } };

describe("CardScreen", () => {
  test("not enrolled starts verification and opens the Bridge-hosted link", async () => {
    const { view, commands, onOpenVerification } = renderScreen("not-enrolled");
    fireEvent.click(view.getByRole("button", { name: "Get your card" }));
    await waitFor(() => expect(onOpenVerification).toHaveBeenCalledWith("https://bridge.withpersona.com/verify?inquiry-template-id=itmpl_test"));
    expect(commands.enroll).toHaveBeenCalledTimes(1);
  });

  test("verification required continues verification; pending offers no action", async () => {
    const required = renderScreen("verification-required");
    expect(required.view.getByText("Verify your identity")).toBeTruthy();
    fireEvent.click(required.view.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(required.onOpenVerification).toHaveBeenCalledTimes(1));
    cleanup();
    const pending = renderScreen("verification-pending");
    expect(pending.view.getByText("Checking your details")).toBeTruthy();
    expect(pending.view.queryByRole("button")).toBeNull();
  });

  test("a failed enrollment keeps the customer on the screen", async () => {
    const { view, commands, onOpenVerification } = renderScreen("verification-required");
    commands.enroll.mockImplementationOnce(async () => { throw new Error("unavailable"); });
    fireEvent.click(view.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(commands.enroll).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(view.getByRole("button", { name: "Verify" }).hasAttribute("disabled")).toBe(false));
    expect(onOpenVerification).not.toHaveBeenCalled();
  });

  test("ready to issue and canceled cards issue a card", async () => {
    const ready = renderScreen("ready-to-issue");
    fireEvent.click(ready.view.getByRole("button", { name: "Create your card" }));
    await waitFor(() => expect(ready.commands.issue).toHaveBeenCalledTimes(1));
    cleanup();
    const canceled = renderScreen("canceled");
    expect(canceled.view.getByText("Your card was canceled")).toBeTruthy();
    fireEvent.click(canceled.view.getByRole("button", { name: "Get a new card" }));
    await waitFor(() => expect(canceled.commands.issue).toHaveBeenCalledTimes(1));
  });

  test("ineligible explains the outcome without an action", () => {
    const { view } = renderScreen("ineligible");
    expect(view.getByText("Card isn't available for your account")).toBeTruthy();
    expect(view.queryByRole("button")).toBeNull();
  });

  test("unavailable, failed reads and a missing live card offer retry", () => {
    for (const state of ["unavailable", "failed"] as const) {
      const { view, onRetry } = renderScreen(state);
      fireEvent.click(view.getByRole("button", { name: "Try again" }));
      expect(onRetry).toHaveBeenCalledTimes(1);
      cleanup();
    }
    const view = render(<CardScreen cards={{ status: "ready", response: { ...cardsBody("active"), cards: [] } }}
      commands={{ enroll: jest.fn(), issue: jest.fn(), setFrozen: jest.fn() }} onRetry={() => {}} onOpenVerification={() => {}} />);
    expect(view.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  test("loading shows no card actions", () => {
    const { view } = renderScreen("loading");
    expect(view.getByLabelText("Loading card").getAttribute("aria-busy")).toBe("true");
    expect(view.queryByRole("button")).toBeNull();
  });

  test("active and frozen cards lock and unlock through the switch", async () => {
    const active = renderScreen("active", { reveal });
    expect(active.view.getByRole("img", { name: "Virtual card ending 4821" })).toBeTruthy();
    const toggle = active.view.getByRole("switch", { name: "Lock card" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    await waitFor(() => expect(active.commands.setFrozen).toHaveBeenCalledWith("ic_fixture4821", true));
    cleanup();
    const frozen = renderScreen("frozen", { reveal });
    expect(frozen.view.getByRole("img", { name: "Virtual card ending 4821, locked" })).toBeTruthy();
    fireEvent.click(frozen.view.getByRole("switch", { name: "Lock card" }));
    await waitFor(() => expect(frozen.commands.setFrozen).toHaveBeenCalledWith("ic_fixture4821", false));
    expect(frozen.view.getByRole("button", { name: "Card details" })).toBeTruthy();
  });

  test("restricted cards cannot be unlocked or revealed", () => {
    const { view, commands } = renderScreen("restricted", { reveal });
    expect(view.getByText("Your card is on hold")).toBeTruthy();
    const toggle = view.getByRole("switch", { name: "Lock card" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(toggle);
    expect(commands.setFrozen).not.toHaveBeenCalled();
    expect(view.queryByRole("button", { name: "Card details" })).toBeNull();
  });

  test("an active card under a restricted customer can still be locked", async () => {
    const response = { ...cardsBody("restricted"), cards: [{ id: "ic_fixture4821", status: "active" as const, last4: "4821" }] };
    const commands = { enroll: jest.fn(), issue: jest.fn(), setFrozen: jest.fn(async () => {}) };
    const view = render(<CardScreen cards={{ status: "ready", response }} commands={commands} onRetry={() => {}} onOpenVerification={() => {}} reveal={reveal} />);
    fireEvent.click(view.getByRole("switch", { name: "Lock card" }));
    await waitFor(() => expect(commands.setFrozen).toHaveBeenCalledWith("ic_fixture4821", true));
    expect(view.queryByRole("button", { name: "Card details" })).toBeNull();
  });

  test("card details are offered only with a publishable key", () => {
    const withoutKey = renderScreen("active");
    expect(withoutKey.view.queryByRole("button", { name: "Card details" })).toBeNull();
    cleanup();
    const withKey = renderScreen("active", { reveal });
    expect(withKey.view.getByRole("button", { name: "Card details" })).toBeTruthy();
  });
});

describe("stripePublishableKey", () => {
  test("accepts only Stripe publishable keys", () => {
    expect(stripePublishableKey("pk_test_abc123")).toBe("pk_test_abc123");
    expect(stripePublishableKey(" pk_live_abc123 ")).toBe("pk_live_abc123");
    for (const value of [undefined, "", "sk_test_abc123", "rk_live_abc", "pk_test_"]) expect(stripePublishableKey(value)).toBeNull();
  });
});
