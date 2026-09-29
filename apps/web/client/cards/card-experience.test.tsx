import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, jest, test } from "bun:test";
import type { CardState } from "@/shared/cards/contract";
import { getHomeQueryClient } from "@/client/query/query-client";
import { cardsBody } from "@/tests/browser/fixtures/bodies";

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { CardScreen, cardScreenData } = await import("./card-experience");
const { stripePublishableKey } = await import("./card-reveal");
const { CardRefreshError, useCards } = await import("./use-cards");
const { Toaster, toast } = await import("@/components/ui/toast");

afterEach(() => { cleanup(); toast.close(); getHomeQueryClient().clear(); });

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

describe("CardScreen review states", () => {
  const quietCommands = () => ({ enroll: jest.fn(), issue: jest.fn(), setFrozen: jest.fn(async () => {}) });

  test("not enrolled does not promise spending from Cash", () => {
    const { view } = renderScreen("not-enrolled");
    expect(view.getByText("Spend online anywhere cards work")).toBeTruthy();
    expect(view.getByText("Lock it anytime")).toBeTruthy();
    expect(view.queryByText("Spend straight from your Cash")).toBeNull();
  });

  test("a restricted customer without a card sees an on-hold notice with no action", () => {
    const view = render(<CardScreen cards={{ status: "ready", response: { ...cardsBody("restricted"), cards: [] } }}
      commands={quietCommands()} onRetry={() => {}} onOpenVerification={() => {}} reveal={reveal} />);
    expect(view.getByText("Your card is on hold")).toBeTruthy();
    expect(view.getByText("You can't create a card right now.")).toBeTruthy();
    expect(view.queryByText("Card is unavailable right now")).toBeNull();
    expect(view.queryByRole("button")).toBeNull();
  });

  test("every live card renders newest first with its own lock control", async () => {
    const response = { ...cardsBody("frozen"), cards: [
      { id: "ic_old1111", status: "frozen" as const, last4: "1111" },
      { id: "ic_gone0000", status: "canceled" as const, last4: "0000" },
      { id: "ic_new2222", status: "active" as const, last4: "2222" },
    ] };
    const commands = quietCommands();
    const view = render(<CardScreen cards={{ status: "ready", response }} commands={commands} onRetry={() => {}} onOpenVerification={() => {}} reveal={reveal} />);
    expect(view.getAllByRole("img").map((item) => item.getAttribute("aria-label"))).toEqual([
      "Virtual card ending 2222", "Virtual card ending 1111, locked",
    ]);
    expect(view.getByRole("button", { name: "Card details ending 2222" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Card details ending 1111" })).toBeTruthy();
    fireEvent.click(view.getByRole("switch", { name: "Lock card ending 1111" }));
    await waitFor(() => expect(commands.setFrozen).toHaveBeenCalledWith("ic_old1111", false));
    await waitFor(() => expect(view.getByRole("switch", { name: "Lock card ending 2222" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(view.getByRole("switch", { name: "Lock card ending 2222" }));
    await waitFor(() => expect(commands.setFrozen).toHaveBeenCalledWith("ic_new2222", true));
  });

  test("cards that share their last four digits are told apart by position", () => {
    const response = { ...cardsBody("active"), cards: [
      { id: "ic_old4821", status: "frozen" as const, last4: "4821" },
      { id: "ic_new4821", status: "active" as const, last4: "4821" },
      { id: "ic_mid1111", status: "active" as const, last4: "1111" },
    ] };
    const view = render(<CardScreen cards={{ status: "ready", response }} commands={quietCommands()} onRetry={() => {}} onOpenVerification={() => {}} reveal={reveal} />);
    expect(view.getAllByRole("img").map((item) => item.getAttribute("aria-label"))).toEqual([
      "Virtual card ending 1111", "Virtual card 2 ending 4821", "Virtual card 3 ending 4821, locked",
    ]);
    expect(view.getByRole("switch", { name: "Lock card ending 1111" })).toBeTruthy();
    expect(view.getByRole("switch", { name: "Lock card 2 ending 4821" }).getAttribute("aria-checked")).toBe("false");
    expect(view.getByRole("switch", { name: "Lock card 3 ending 4821" }).getAttribute("aria-checked")).toBe("true");
    expect(view.getByRole("button", { name: "Card details for card 2 ending 4821" })).toBeTruthy();
    expect(view.getByRole("heading", { name: "Card 3 ending 4821" })).toBeTruthy();
  });

  test("a lock that settles after the owner changes does not toast on the new owner's screen", async () => {
    let settle: (() => void) | undefined;
    const commands = { ...quietCommands(), setFrozen: jest.fn(() => new Promise<void>((resolve) => { settle = resolve; })) };
    const screen = (owner: string) => (
      <><CardScreen cards={{ status: "ready", response: cardsBody("active") }} commands={commands}
        onRetry={() => {}} onOpenVerification={() => {}} ownerBoundary={owner} /><Toaster /></>
    );
    const view = render(screen("owner-1"));
    fireEvent.click(view.getByRole("switch", { name: "Lock card" }));
    await waitFor(() => expect(commands.setFrozen).toHaveBeenCalledTimes(1));
    view.rerender(screen("owner-2"));
    expect(view.getByRole("switch", { name: "Lock card" }).hasAttribute("disabled")).toBe(false);
    await act(async () => settle?.());
    expect(view.queryByText("Card locked")).toBeNull();
    fireEvent.click(view.getByRole("switch", { name: "Lock card" }));
    await waitFor(() => expect(commands.setFrozen).toHaveBeenCalledTimes(2));
    await act(async () => settle?.());
    expect((await view.findAllByText("Card locked")).length).toBeGreaterThan(0);
  });

  test("a write from an earlier session of the same owner stays silent after the owner returns", async () => {
    const writes: { resolve: () => void; reject: (error: Error) => void }[] = [];
    const commands = { ...quietCommands(), setFrozen: jest.fn(() => new Promise<void>((resolve, reject) => { writes.push({ resolve, reject }); })) };
    const screen = (owner: string) => (
      <><CardScreen cards={{ status: "ready", response: cardsBody("active") }} commands={commands}
        onRetry={() => {}} onOpenVerification={() => {}} ownerBoundary={owner} /><Toaster /></>
    );
    const view = render(screen("owner-a"));
    fireEvent.click(view.getByRole("switch", { name: "Lock card" }));
    await waitFor(() => expect(commands.setFrozen).toHaveBeenCalledTimes(1));
    view.rerender(screen("owner-b"));
    view.rerender(screen("owner-a"));
    expect(view.getByRole("switch", { name: "Lock card" }).hasAttribute("disabled")).toBe(false);
    await act(async () => writes[0]?.resolve());
    expect(view.queryByText("Card locked")).toBeNull();
    fireEvent.click(view.getByRole("switch", { name: "Lock card" }));
    await waitFor(() => expect(commands.setFrozen).toHaveBeenCalledTimes(2));
    view.rerender(screen("owner-b"));
    view.rerender(screen("owner-a"));
    await act(async () => writes[1]?.reject(new Error("lock failed")));
    expect(view.queryByText("Couldn't lock your card. Try again.")).toBeNull();
    expect(view.getByRole("switch", { name: "Lock card" }).hasAttribute("disabled")).toBe(false);
  });

  test("a failed re-read after a lock shows an error, not a success toast", async () => {
    const commands = { ...quietCommands(), setFrozen: jest.fn(async () => { throw new CardRefreshError(); }) };
    const view = render(<><CardScreen cards={{ status: "ready", response: cardsBody("active") }} commands={commands}
      onRetry={() => {}} onOpenVerification={() => {}} /><Toaster /></>);
    fireEvent.click(view.getByRole("switch", { name: "Lock card" }));
    expect((await view.findAllByText("Couldn't refresh your card. Try again.")).length).toBeGreaterThan(0);
    expect(view.queryByText("Card locked")).toBeNull();
  });

  test("a failed card issue request shows an error and no new card", async () => {
    const posts: string[] = [];
    const fetchAccountResource = jest.fn(async (path: string, options?: { method?: string }) => {
      if (options?.method === "POST") {
        posts.push(path);
        throw new Error("card issue failed");
      }
      return cardsBody("ready-to-issue");
    });
    function Harness() {
      const { query, refresh, commands } = useCards({ ownerKey: "owner-1", fetchAccountResource });
      return <><CardScreen cards={cardScreenData(query)} commands={commands} onRetry={() => void refresh()} onOpenVerification={() => {}} /><Toaster /></>;
    }
    const view = render(<Harness />);
    fireEvent.click(await view.findByRole("button", { name: "Create your card" }));
    expect((await view.findAllByText("Couldn't create your card. Try again.")).length).toBeGreaterThan(0);
    expect(posts).toEqual(["/api/cards"]);
    await waitFor(() => expect(view.getByRole("button", { name: "Create your card" }).hasAttribute("disabled")).toBe(false));
    expect(view.queryByRole("img", { name: /Virtual card/ })).toBeNull();
    expect(view.queryByText("Couldn't refresh your card. Try again.")).toBeNull();
  });

  test("the latest failed read wins over earlier card data", () => {
    expect(cardScreenData({ data: cardsBody("active"), isError: true })).toEqual({ status: "failed" });
    expect(cardScreenData({ data: undefined, isError: false })).toEqual({ status: "loading" });
  });

  test("freeze followed by a failed card read renders unavailable with retry", async () => {
    let readFails = false;
    const fetchAccountResource = jest.fn(async (path: string, options?: { method?: string }) => {
      if (options?.method === "POST") {
        readFails = true;
        return { version: 1, card: { id: "ic_fixture4821", status: "frozen" } };
      }
      if (readFails) throw new Error("cards read failed");
      return cardsBody("active");
    });
    function Harness() {
      const { query, refresh, commands } = useCards({ ownerKey: "owner-1", fetchAccountResource });
      return <><CardScreen cards={cardScreenData(query)} commands={commands} onRetry={() => void refresh()} onOpenVerification={() => {}} /><Toaster /></>;
    }
    const view = render(<Harness />);
    fireEvent.click(await view.findByRole("switch", { name: "Lock card" }));
    expect(await view.findByText("Card is unavailable right now")).toBeTruthy();
    expect((await view.findAllByText("Couldn't refresh your card. Try again.")).length).toBeGreaterThan(0);
    expect(view.queryByText("Card locked")).toBeNull();
    expect(view.queryByRole("switch")).toBeNull();
    readFails = false;
    fetchAccountResource.mockImplementation(async () => cardsBody("frozen"));
    fireEvent.click(view.getByRole("button", { name: "Try again" }));
    expect(await view.findByRole("img", { name: "Virtual card ending 4821, locked" })).toBeTruthy();
  });
});

describe("stripePublishableKey", () => {
  test("accepts only Stripe publishable keys", () => {
    expect(stripePublishableKey("pk_test_abc123")).toBe("pk_test_abc123");
    expect(stripePublishableKey(" pk_live_abc123 ")).toBe("pk_live_abc123");
    for (const value of ["", "   ", "sk_test_abc123", "rk_live_abc", "pk_test_"]) expect(stripePublishableKey(value)).toBeNull();
  });
});
