import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { http, HttpResponse } from "msw";
import { Toaster } from "@/components/ui/toast";
import type { CardsResponse, CardState } from "@/shared/cards/contract";
import { cardsBody } from "@/tests/browser/fixtures/bodies";
import { CardScreen, type CardScreenData } from "./card-experience";
import { CardRefreshError } from "./use-cards";
import type { CardSpendingData, CardSpendingCommands } from "./card-spending";
import type { CardAllowancePrepareParams } from "@/shared/cards/allowance-contract";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { BASE_USDC_ADDRESS } from "@/shared/money-actions/network-fee";
import { ExpirySchedulerContext } from "@/client/actions/expiry";

const actions = { onOpenVerification: fn(), onRetry: fn(), issue: fn(), setFrozen: fn() };
const kycUrl = "https://bridge.withpersona.com/verify?inquiry-template-id=itmpl_story";
const reveal = { publishableKey: "pk_test_story", revealKey: async (): Promise<never> => { throw new Error("Stripe is not loaded in stories."); } };

const twoCards: CardsResponse = { ...cardsBody("frozen"), cards: [
  { id: "ic_fixture1107", status: "frozen", last4: "1107" },
  { id: "ic_fixture4821", status: "active", last4: "4821" },
] };

const spendingSpender = "0x2222222222222222222222222222222222222222";
const retiredSpender = "0x3333333333333333333333333333333333333333";
const otherRetiredSpender = "0x4444444444444444444444444444444444444444";
const spendingReady: Extract<CardSpendingData, { status: "ready" }> = { status: "ready", response: {
  version: 1, status: "available", setEnabled: true, spender: spendingSpender, walletBaseUnits: "100000000", allowanceBaseUnits: "25000000", availableBaseUnits: "25000000", retired: [], blockNumber: "1", fetchedAt: "2026-09-28T12:00:00.000Z",
} };

function preparedSpending(params: CardAllowancePrepareParams): PreparedMoneyAction {
  return {
    id: "card-allowance-story", kind: "card-allowance", title: "Card spending limit", calls: [], amounts: [], warnings: ["Allow card purchases from Cash."],
    owner: { subject: "story-owner", address: "0x1111111111111111111111111111111111111111", chainId: 8453, accountProvider: "cdp-embedded" },
    createdAt: "2026-09-28T12:00:00.000Z", expiresAt: "2026-09-28T12:05:00.000Z",
    metadata: { product: "card", provider: "bridge", mode: "production", operation: params.operation === "set" ? "set-allowance" : "revoke-allowance", token: BASE_USDC_ADDRESS.toLowerCase() as `0x${string}`, spender: params.operation === "revoke" ? params.spender : spendingSpender, previousAllowanceBaseUnits: "25000000", allowanceBaseUnits: params.operation === "set" ? params.allowanceBaseUnits : "0", maximumBaseUnits: params.operation === "set" ? "1000000000" : null, source: { blockNumber: "1" } },
  };
}
const spendingCommands: CardSpendingCommands = {
  prepare: async (params) => preparedSpending(params),
  execute: async () => ({ id: "card-allowance-story", status: "rejected" }),
  fetchOperations: async () => ({ actions: [] }),
};

function CardStateStory({ state, initial, refreshFails = false, lockOutcome, withReveal = true, spending }: {
  state: CardState | "loading" | "failed";
  initial?: CardsResponse;
  refreshFails?: boolean;
  lockOutcome?: "hangs" | "fails";
  withReveal?: boolean;
  spending?: CardSpendingData;
}) {
  const [response, setResponse] = useState(() => initial ?? (state === "loading" || state === "failed" ? null : cardsBody(state)));
  const [readFailed, setReadFailed] = useState(state === "failed");
  const cards: CardScreenData = readFailed ? { status: "failed" } : response ? { status: "ready", response } : { status: "loading" };
  return (
    <div className="mx-auto max-w-xl p-4">
      <ExpirySchedulerContext value={{ now: () => Date.parse("2026-09-28T12:00:00.000Z"), setTimeout: () => 0, clearTimeout: () => {} }}>
      <CardScreen
        cards={cards}
        onRetry={() => { actions.onRetry(); if (refreshFails) setReadFailed(false); }}
        onOpenVerification={actions.onOpenVerification}
        reveal={withReveal ? reveal : undefined}
        spending={spending}
        spendingCommands={spendingCommands}
        onSpendingRetry={actions.onRetry}
        commands={{
          enroll: async () => kycUrl,
          issue: async () => { actions.issue(); setResponse(cardsBody("active")); },
          setFrozen: async (cardId, frozen) => {
            actions.setFrozen(cardId, frozen);
            if (lockOutcome === "hangs") return new Promise<never>(() => {});
            if (lockOutcome === "fails") throw new Error("Card lock failed.");
            setResponse(cardsBody(frozen ? "frozen" : "active"));
            if (refreshFails) { setReadFailed(true); throw new CardRefreshError(); }
          },
        }}
      />
      </ExpirySchedulerContext>
      <Toaster />
    </div>
  );
}

const meta = {
  id: "client-cards-card-screen",
  title: "Client/Cards/Card screen",
  component: CardStateStory,
  args: { state: "active" },
  parameters: { layout: "fullscreen", viewport: { defaultViewport: "mobile" }, msw: { handlers: [http.post("/api/client-errors", () => new HttpResponse(null, { status: 204 }))] } },
} satisfies Meta<typeof CardStateStory>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NotEnrolled: Story = {
  args: { state: "not-enrolled" },
  play: async ({ canvasElement }) => {
    actions.onOpenVerification.mockClear();
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Get your card" }));
    await waitFor(() => expect(actions.onOpenVerification).toHaveBeenCalledWith(kycUrl));
  },
};
export const VerificationRequired: Story = {
  args: { state: "verification-required" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Verify your identity")).toBeVisible();
    actions.onOpenVerification.mockClear();
    await userEvent.click(canvas.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(actions.onOpenVerification).toHaveBeenCalledTimes(1));
  },
};
export const VerificationPending: Story = {
  args: { state: "verification-pending" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("Checking your details")).toBeVisible();
    await expect(within(canvasElement).queryByRole("button")).toBeNull();
  },
};
export const Ineligible: Story = { args: { state: "ineligible" } };
export const ReadyToIssue: Story = {
  args: { state: "ready-to-issue" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Create your card" }));
    await expect(await canvas.findByRole("img", { name: "Virtual card ending 4821" })).toBeVisible();
  },
};
export const Active: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Card details" })).toBeVisible();
    await expect(canvas.getByRole("switch", { name: "Lock card" })).not.toBeChecked();
  },
};
export const LockPending: Story = {
  args: { state: "active", lockOutcome: "hangs" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const control = canvas.getByRole("switch", { name: "Lock card" });
    await userEvent.click(control);
    await expect(control).toBeChecked();
    await expect(control).toHaveAttribute("aria-busy", "true");
    await expect(control).not.toHaveAttribute("aria-disabled", "true");
    await expect(canvas.getByText("Locking…")).toBeVisible();
    await expect(canvas.getByRole("img", { name: "Virtual card ending 4821" })).toBeVisible();
    await expect(within(document.body).queryByText("Card locked")).toBeNull();
    await userEvent.click(control);
    await expect(control).toBeChecked();
    await expect(canvas.getByText("Locking…")).toBeVisible();
  },
};
export const LockFailure: Story = {
  args: { state: "active", lockOutcome: "fails" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const control = canvas.getByRole("switch", { name: "Lock card" });
    await userEvent.click(control);
    const [toast] = await within(document.body).findAllByText("Couldn't lock your card. Try again.");
    await expect(toast).toBeVisible();
    await expect(control).not.toBeChecked();
    await expect(canvas.getByText("Pause new purchases")).toBeVisible();
  },
};
export const ActiveWithoutPublishableKey: Story = {
  args: { withReveal: false },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole("button", { name: "Card details" })).toBeNull();
  },
};
export const Frozen: Story = { args: { state: "frozen" } };
export const Restricted: Story = {
  args: { state: "restricted" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Your card is on hold")).toBeVisible();
    await expect(canvas.getByRole("switch", { name: "Lock card" })).toHaveAttribute("aria-disabled", "true");
    await expect(canvas.queryByRole("button", { name: "Card details" })).toBeNull();
  },
};
export const Canceled: Story = { args: { state: "canceled" } };
export const RestrictedBeforeIssue: Story = {
  args: { state: "restricted", initial: { ...cardsBody("restricted"), cards: [] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Your card is on hold")).toBeVisible();
    await expect(canvas.getByText("You can't create a card right now.")).toBeVisible();
    await expect(canvas.queryByRole("button")).toBeNull();
  },
};
export const TwoCards: Story = {
  args: { state: "frozen", initial: twoCards },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole("img").map((item) => item.getAttribute("aria-label"))).toEqual([
      "Virtual card ending 4821", "Virtual card ending 1107, locked",
    ]);
    await expect(canvas.getByRole("switch", { name: "Lock card ending 4821" })).not.toBeChecked();
    await expect(canvas.getByRole("switch", { name: "Lock card ending 1107" })).toBeChecked();
  },
};
export const RefreshFailureAfterLock: Story = {
  args: { state: "active", refreshFails: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("switch", { name: "Lock card" }));
    await expect(await canvas.findByText("Card is unavailable right now")).toBeVisible();
    await expect(canvas.queryByText("Card locked")).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
    await expect(await canvas.findByRole("img", { name: "Virtual card ending 4821, locked" })).toBeVisible();
  },
};
export const Unavailable: Story = {
  args: { state: "unavailable" },
  play: async ({ canvasElement }) => {
    actions.onRetry.mockClear();
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Try again" }));
    await expect(actions.onRetry).toHaveBeenCalledTimes(1);
  },
};
export const Loading: Story = { args: { state: "loading" } };

export const SpendingReady: Story = {
  args: { spending: spendingReady },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Turn off" }));
    const dialog = within(await within(document.body).findByRole("dialog"));
    await waitFor(() => expect(dialog.getByText(spendingSpender)).toBeVisible());
    await expect(dialog.getByText("Card purchases from Cash")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Turn off" })).toHaveAttribute("data-money-action-id", "card-allowance-story");
  },
};
export const SpendingAfterCancel: Story = {
  args: { state: "canceled", spending: spendingReady },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Your card was canceled")).toBeVisible();
    await expect(canvas.getByRole("region", { name: "Spending" })).toBeVisible();
    await expect(canvas.queryByText("Available to spend")).toBeNull();
    await expect(canvas.queryByText("Spending limit")).toBeNull();
    await expect(canvas.queryByRole("button", { name: "Change" })).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Turn off" }));
    const dialog = within(await within(document.body).findByRole("dialog"));
    await waitFor(() => expect(dialog.getByText(spendingSpender)).toBeVisible());
    await expect(dialog.getByRole("button", { name: "Turn off" })).toHaveAttribute("data-money-action-id", "card-allowance-story");
  },
};
export const SpendingNotSet: Story = {
  args: { spending: { status: "ready", response: { ...spendingReady.response, allowanceBaseUnits: "0", availableBaseUnits: "0" } } },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Set limit" }));
    const dialog = within(await within(document.body).findByRole("dialog"));
    await userEvent.type(dialog.getByRole("textbox"), "25");
    await userEvent.click(dialog.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(dialog.getByText(spendingSpender)).toBeVisible());
    await expect(dialog.getByText("Card purchases from Cash")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Set limit" })).toHaveAttribute("data-money-action-id", "card-allowance-story");
  },
};
export const SpendingDisabled: Story = { args: { spending: { status: "ready", response: { ...spendingReady.response, setEnabled: false } } } };
export const SpendingNotConfigured: Story = { args: { spending: { status: "not-configured" } } };
export const SpendingUnavailable: Story = { args: { spending: { status: "unavailable" } } };
export const RetiredPermission: Story = {
  args: { spending: { status: "ready", response: { ...spendingReady.response, retired: [{ spender: retiredSpender, allowanceBaseUnits: "10000000" }, { spender: otherRetiredSpender, allowanceBaseUnits: "10000000" }] } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Remove old card program 0x3333…333333" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Remove old card program 0x4444…444444" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Remove old card program 0x3333…333333" }));
    const dialog = within(await within(document.body).findByRole("dialog"));
    await waitFor(() => expect(dialog.getByText(retiredSpender)).toBeVisible());
    await expect(dialog.getByText("Card purchases from Cash")).toBeVisible();
  },
};
