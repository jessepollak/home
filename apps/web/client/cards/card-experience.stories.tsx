import { useCallback, useId, useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { http, HttpResponse } from "msw";
import { Toaster } from "@/components/ui/toast";
import type { CardsResponse, CardState } from "@/shared/cards/contract";
import { cardsBody } from "@/tests/browser/fixtures/bodies";
import { CardScreen, cardScreenData, type CardScreenData } from "./card-experience";
import { CardRefreshError, useCards } from "./use-cards";
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

const spendingPermissions: CardSpendingData = { status: "ready", response: {
  ...spendingReady.response, retired: [{ spender: retiredSpender, allowanceBaseUnits: "10000000" }],
} };

async function expectSpendingHidden(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await expect(canvas.queryByRole("region", { name: "Spending" })).toBeNull();
  await expect(canvas.queryByRole("button", { name: "Turn off" })).toBeNull();
  await expect(canvas.queryByRole("button", { name: /^Remove old card program/ })).toBeNull();
}

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
  fetchOperations: async () => ({ version: 1, actions: [], truncated: false }),
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

const pollAdvance = { advanced: false, listeners: new Set<() => void>() };

function releasePollAdvance() {
  pollAdvance.advanced = true;
  for (const listener of pollAdvance.listeners) listener();
  pollAdvance.listeners.clear();
}

async function waitForPollAdvance() {
  if (pollAdvance.advanced) return;
  await new Promise<void>((resolve) => pollAdvance.listeners.add(resolve));
}

function PollingCardStory() {
  const ownerKey = `card-polling-story-${useId()}`;
  const readCount = useRef(0);
  const [reads, setReads] = useState(0);
  const fetchAccountResource = useCallback(async (path: string) => {
    if (path !== "/api/cards") throw new Error(`Unexpected card story request: ${path}`);
    readCount.current += 1;
    setReads(readCount.current);
    if (readCount.current > 1) await waitForPollAdvance();
    return cardsBody(readCount.current === 1 ? "verification-pending" : "ready-to-issue");
  }, []);
  const { query, refresh, commands } = useCards({ ownerKey, fetchAccountResource, intervalMs: 100 });
  return (
    <div className="mx-auto max-w-xl p-4" data-card-reads={reads}>
      <CardScreen cards={cardScreenData(query)} commands={commands} onRetry={() => void refresh()} onOpenVerification={actions.onOpenVerification} spending={spendingPermissions} spendingCommands={spendingCommands} />
    </div>
  );
}

const transientPoll = { phase: 0, listeners: new Set<() => void>() };

function releaseTransientPoll(phase: number) {
  transientPoll.phase = phase;
  for (const listener of transientPoll.listeners) listener();
  transientPoll.listeners.clear();
}

async function waitForTransientPoll(phase: number) {
  if (transientPoll.phase >= phase) return;
  await new Promise<void>((resolve) => transientPoll.listeners.add(resolve));
}

function TransientPollingCardStory() {
  const ownerKey = `card-transient-polling-story-${useId()}`;
  const readCount = useRef(0);
  const [reads, setReads] = useState(0);
  const fetchAccountResource = useCallback(async (path: string) => {
    if (path !== "/api/cards") throw new Error(`Unexpected card story request: ${path}`);
    readCount.current += 1;
    setReads(readCount.current);
    if (readCount.current === 2) await waitForTransientPoll(1);
    if (readCount.current > 2) await waitForTransientPoll(2);
    const state: CardState = readCount.current === 1 ? "verification-pending" : readCount.current === 2 ? "unavailable" : "ready-to-issue";
    return cardsBody(state);
  }, []);
  const { query, refresh, commands } = useCards({ ownerKey, fetchAccountResource, intervalMs: 100 });
  return (
    <div className="mx-auto max-w-xl p-4" data-card-reads={reads}>
      <CardScreen cards={cardScreenData(query)} commands={commands} onRetry={() => void refresh()} onOpenVerification={actions.onOpenVerification} spending={spendingPermissions} spendingCommands={spendingCommands} />
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
  args: { state: "not-enrolled", spending: spendingPermissions },
  play: async ({ canvasElement }) => {
    await expectSpendingHidden(canvasElement);
    actions.onOpenVerification.mockClear();
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Get your card" }));
    await waitFor(() => expect(actions.onOpenVerification).toHaveBeenCalledWith(kycUrl));
  },
};
export const VerificationRequired: Story = {
  args: { state: "verification-required", spending: spendingPermissions },
  play: async ({ canvasElement }) => {
    await expectSpendingHidden(canvasElement);
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Verify your identity")).toBeVisible();
    actions.onOpenVerification.mockClear();
    await userEvent.click(canvas.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(actions.onOpenVerification).toHaveBeenCalledTimes(1));
  },
};
export const VerificationPending: Story = {
  args: { state: "verification-pending", spending: spendingPermissions },
  play: async ({ canvasElement }) => {
    await expectSpendingHidden(canvasElement);
    await expect(within(canvasElement).getByText("Checking your details")).toBeVisible();
    await expect(within(canvasElement).queryByRole("button")).toBeNull();
  },
};
export const VerificationAdvancesWithoutReload: Story = {
  render: () => <PollingCardStory />,
  play: async ({ canvasElement }) => {
    pollAdvance.advanced = false;
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Checking your details")).toBeVisible();
    await expectSpendingHidden(canvasElement);
    await expect(canvas.queryByRole("button")).toBeNull();
    releasePollAdvance();
    await expect(await canvas.findByRole("button", { name: "Create your card" })).toBeVisible();
    await expectSpendingHidden(canvasElement);
    await expect(canvasElement.querySelector("[data-card-reads]")).toHaveAttribute("data-card-reads", "2");
  },
};
export const VerificationSurvivesTransientUnavailable: Story = {
  render: () => <TransientPollingCardStory />,
  play: async ({ canvasElement }) => {
    transientPoll.phase = 0;
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Checking your details")).toBeVisible();
    releaseTransientPoll(1);
    await expect(await canvas.findByText("Card is unavailable right now")).toBeVisible();
    releaseTransientPoll(2);
    await expect(await canvas.findByRole("button", { name: "Create your card" })).toBeVisible();
    await expect(canvasElement.querySelector("[data-card-reads]")).toHaveAttribute("data-card-reads", "3");
  },
};
export const Ineligible: Story = {
  args: { state: "ineligible", spending: spendingPermissions },
  play: async ({ canvasElement }) => expectSpendingHidden(canvasElement),
};
export const ReadyToIssue: Story = {
  args: { state: "ready-to-issue", spending: spendingPermissions },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expectSpendingHidden(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Create your card" }));
    await expect(await canvas.findByRole("img", { name: "Virtual card ending 4821" })).toBeVisible();
    await expect(canvas.getByRole("region", { name: "Spending" })).toBeVisible();
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
export const Frozen: Story = {
  args: { state: "frozen", spending: spendingPermissions },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("region", { name: "Spending" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Change" })).toBeEnabled();
  },
};
export const Restricted: Story = {
  args: { state: "restricted", spending: spendingPermissions },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Your card is on hold")).toBeVisible();
    await expect(canvas.getByRole("switch", { name: "Lock card" })).toHaveAttribute("aria-disabled", "true");
    await expect(canvas.queryByRole("button", { name: "Card details" })).toBeNull();
    await expect(canvas.getByRole("region", { name: "Spending" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Change" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Turn off" })).toBeEnabled();
    await expect(canvas.getByRole("button", { name: /^Remove old card program/ })).toBeEnabled();
  },
};
export const Canceled: Story = { args: { state: "canceled" } };
export const RestrictedBeforeIssue: Story = {
  args: { state: "restricted", initial: { ...cardsBody("restricted"), cards: [] }, spending: spendingPermissions },
  play: async ({ canvasElement }) => {
    await expectSpendingHidden(canvasElement);
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Your card is on hold")).toBeVisible();
    await expect(canvas.getByText("You can't create a card right now.")).toBeVisible();
    await expect(canvas.queryByRole("button")).toBeNull();
  },
};
export const ActiveWithoutCards: Story = {
  args: { initial: { ...cardsBody("active"), cards: [] }, spending: spendingPermissions },
  play: async ({ canvasElement }) => expectSpendingHidden(canvasElement),
};
export const FrozenWithoutCards: Story = {
  args: { state: "frozen", initial: { ...cardsBody("frozen"), cards: [] }, spending: spendingPermissions },
  play: async ({ canvasElement }) => expectSpendingHidden(canvasElement),
};
export const CanceledWithoutCards: Story = {
  args: { state: "canceled", initial: { ...cardsBody("canceled"), cards: [] }, spending: spendingPermissions },
  play: async ({ canvasElement }) => expectSpendingHidden(canvasElement),
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
export const RetiredPermissionAfterCancel: Story = {
  args: { state: "canceled", spending: { status: "ready", response: {
    ...spendingReady.response, allowanceBaseUnits: "0", availableBaseUnits: "0",
    retired: [{ spender: retiredSpender, allowanceBaseUnits: "10000000" }],
  } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("region", { name: "Spending" })).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Turn off" })).toBeNull();
    await expect(canvas.queryByText("Available to spend")).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: /^Remove old card program/ }));
    const dialog = within(await within(document.body).findByRole("dialog"));
    await waitFor(() => expect(dialog.getByText(retiredSpender)).toBeVisible());
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
