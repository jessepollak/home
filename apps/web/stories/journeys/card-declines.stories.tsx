import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { ActivityPanelView } from "@/client/activity/activity-panel";
import { presentActivityLedgerItems } from "@/client/activity/activity-ledger-items";
import { ActivityLedgerDetailSheet } from "@/client/activity/activity-ledger-sheet";
import { isActivityLedgerNextActionAllowed } from "@/client/activity/activity-ledger";
import type { UseActivityResult } from "@/client/activity/use-activity";
import { CARD_PURCHASES_VERSION, type CardPurchase } from "@/shared/cards/transactions-contract";

function purchase(reason: string | null): CardPurchase {
  return {
    id: "iauth_declinefixture", kind: "authorization", amountMinor: "1820", currency: "USD",
    merchantName: "Fixture Market", merchantCategory: null, status: "declined", declineReasonCode: reason,
    createdAt: "2026-09-24T12:00:00.000Z", updatedAt: "2026-09-24T12:00:00.000Z",
  };
}

function detail(card: CardPurchase) {
  const [item] = presentActivityLedgerItems([{ kind: "card", id: card.id, timestamp: card.createdAt, purchase: card }],
    { regionId: "US", timeZone: "UTC" });
  if (!item) throw new Error("Card decline fixture did not present");
  return item;
}

const onCardAction = fn();
function DeclinePanel({ reason, handler = true, cardsEnabled = true }: {
  reason: string | null; handler?: boolean; cardsEnabled?: boolean;
}) {
  const card = purchase(reason);
  const [initialDetailItem, setInitialDetailItem] = useState(() => detail(card));
  const [detailDismissed, setDetailDismissed] = useState(false);
  const activity: UseActivityResult = {
    status: "ready", loadingMore: false, loadMoreError: false, continuing: false,
    page: {
      walletAddress: "0x1111111111111111111111111111111111111111", chainId: 8453,
      window: { from: "2026-09-01T00:00:00.000Z", to: "2026-09-25T00:00:00.000Z" },
      currency: "USD", transfers: [], cards: { version: CARD_PURCHASES_VERSION, status: "ready", rows: [card] }, nextCursor: null, source: null,
    },
    retry: fn(), refresh: fn(), setSentinelVisible: fn(), retryLoadMore: fn(),
  };
  return <main className="mx-auto max-w-2xl p-4">
    <h1 className="sr-only">Card purchase activity</h1>
    <ActivityPanelView activity={activity} initialDetailItem={detailDismissed ? null : initialDetailItem} regionId="US"
      onDetailsSelectionChange={(item) => { if (item) setInitialDetailItem(item); else setDetailDismissed(true); }}
      onCardAction={handler ? onCardAction : undefined} canCardAct={(kind) => kind === "add-money" || cardsEnabled} />
  </main>;
}

const meta = {
  id: "journeys-card-declines", title: "Journeys/Card declines", component: DeclinePanel,
  args: { reason: "card_inactive" },
  parameters: { viewport: { defaultViewport: "mobile" }, a11y: { test: "error" } },
} satisfies Meta<typeof DeclinePanel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Locked: Story = {
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const alert = await screen.findByRole("alert");
    const dialog = within(screen.getByRole("dialog"));
    await expect(alert).toHaveTextContent("Declined because your card was locked");
    await expect(dialog.getByRole("alert")).toHaveTextContent("Nothing was charged.");
    await expect(dialog.queryByText(/card_inactive|card inactive|Available then/)).toBeNull();
    const action = dialog.getByRole("button", { name: "Unlock card" });
    await expect(action).toBeVisible();
    await userEvent.click(action);
    await expect(onCardAction).toHaveBeenCalledWith("unlock-card", expect.any(Function));
    await userEvent.click(dialog.getByRole("button", { name: "Close Fixture Market details" }));
    const row = await screen.findByRole("button", { name: /^Fixture Market/ });
    await expect(row).toHaveAccessibleName(/Card was locked/);
    await expect(row).not.toHaveAccessibleName(/Action needed/);
  },
};
export const InsufficientFunds: Story = {
  args: { reason: "insufficient_funds" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const alert = await screen.findByRole("alert");
    const dialog = within(screen.getByRole("dialog"));
    await expect(alert).toHaveTextContent("Not enough available to spend");
    await expect(dialog.getByRole("alert")).toHaveTextContent("Nothing was charged. Add money and try again.");
    await expect(dialog.queryByText(/insufficient_funds|insufficient funds|Available then/)).toBeNull();
    const action = dialog.getByRole("button", { name: "Add money" });
    await expect(action).toBeVisible();
    await userEvent.click(action);
    await expect(onCardAction).toHaveBeenCalledWith("add-money", expect.any(Function));
    await userEvent.click(dialog.getByRole("button", { name: "Close Fixture Market details" }));
    const row = await screen.findByRole("button", { name: /^Fixture Market/ });
    await expect(row).toHaveAccessibleName(/Not enough Cash/);
    await expect(row).not.toHaveAccessibleName(/Action needed/);
  },
};
export const UnknownReason: Story = {
  args: { reason: "processor_unavailable" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const alert = await screen.findByRole("alert");
    const dialog = within(screen.getByRole("dialog"));
    await expect(alert).toHaveTextContent("Declined");
    await expect(dialog.getByRole("alert")).toHaveTextContent("Nothing was charged.");
    await expect(dialog.queryByText(/processor_unavailable|processor unavailable/)).toBeNull();
    await expect(dialog.getAllByRole("button")).toHaveLength(1);
  },
};
export const NoReason: Story = {
  ...UnknownReason, args: { reason: null },
};
export const NoHandler: Story = {
  args: { handler: false },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const alert = await screen.findByRole("alert");
    const dialog = within(screen.getByRole("dialog"));
    await expect(alert).toHaveTextContent("Declined because your card was locked");
    await expect(dialog.queryByRole("button", { name: "Unlock card" })).toBeNull();
  },
};
export const CardsDisabled: Story = {
  ...NoHandler, args: { cardsEnabled: false },
};
export const SheetWithoutCapability: Story = {
  render: () => <ActivityLedgerDetailSheet item={detail(purchase("card_inactive"))} open onDismiss={fn()} onAction={fn()} />,
  play: async ({ canvasElement }) => {
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog"));
    await expect(dialog.queryByRole("button", { name: "Unlock card" })).toBeNull();
    for (const kind of ["unlock-card", "add-money"] as const) {
      await expect(isActivityLedgerNextActionAllowed("failed", "card", kind)).toBe(true);
      for (const family of ["funding-order", "cash-out-order", "home-action", "onchain-transfer"] as const) {
        await expect(isActivityLedgerNextActionAllowed("failed", family, kind)).toBe(false);
      }
      await expect(isActivityLedgerNextActionAllowed("confirmed", "card", kind)).toBe(false);
    }
    await expect(isActivityLedgerNextActionAllowed("failed", "card", "retry")).toBe(false);
    await expect(isActivityLedgerNextActionAllowed("failed", "home-action", "retry")).toBe(true);
  },
};
