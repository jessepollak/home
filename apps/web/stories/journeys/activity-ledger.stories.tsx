import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import {
  ActivityLedger,
  type ActivityLedgerItem,
} from "@/client/activity/activity-ledger";
import { ActivityLedgerDetailSheet } from "@/client/activity/activity-ledger-sheet";
import { PORTFOLIO_USDC_ASSET_KEY } from "@/config/portfolio-assets";

const funding: ActivityLedgerItem = {
  id: "funding-journey",
  family: "funding-order",
  status: "waiting-customer",
  timestamp: "2026-09-24T12:00:00.000Z",
  dateLabel: "Today",
  title: "Add money",
  amount: "$50.00",
  direction: "in",
  mark: { kind: "glyph", glyph: "cash" },
  ownerSentence: {
    title: "Pay $50.00 by 5:00 PM",
    description: "Then we'll add it to your balance.",
  },
  steps: [
    { status: "complete", title: "Order created", time: "Sep 23, 9:02 AM" },
    { status: "current", title: "Your bank payment", time: "Pay by 5:00 PM" },
    { status: "upcoming", title: "Added to your balance", time: "After your payment arrives" },
  ],
  nextAction: { kind: "complete-payment", label: "Continue payment" },
  detail: {
    family: "funding-order",
    provider: "Coinbase",
    paymentMethod: "Bank transfer",
    orderId: "funding-journey",
  },
};
const transfer: ActivityLedgerItem = {
  id: "transfer-journey",
  family: "onchain-transfer",
  status: "waiting-chain",
  timestamp: "2026-09-24T11:50:00.000Z",
  dateLabel: "Today",
  title: "Sent to alex.base.eth",
  amount: "−$25.00",
  direction: "out",
  mark: { kind: "asset", assetKey: PORTFOLIO_USDC_ASSET_KEY, symbol: "USDC" },
  detail: {
    family: "onchain-transfer",
    counterpartyLabel: "To",
    counterparty: "alex.base.eth",
    network: "Base",
  },
};

const received: ActivityLedgerItem = {
  ...transfer,
  id: "received-journey",
  status: "confirmed",
  title: "Received",
  amount: "+$200.00",
  direction: "in",
  detail: {
    family: "onchain-transfer",
    counterpartyLabel: "From",
    counterparty: "alex.base.eth",
    network: "Base",
  },
};

function Journey() {
  const [selected, setSelected] = useState<ActivityLedgerItem | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(true);
  const opener = useRef<HTMLElement | null>(null);
  const open = (item: ActivityLedgerItem, element: HTMLElement) => {
    opener.current = element;
    setSelected(item);
    setIsOpen(true);
  };
  const closed = () => {
    setSelected(null);
    if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
  };
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">Activity</h1>
      <h2 className="sr-only">Activity list</h2>
      {mounted ? (
        <>
          <ActivityLedger items={[funding, transfer, received]} onOpen={open} />
          <ActivityLedgerDetailSheet item={selected} open={isOpen} onDismiss={() => setIsOpen(false)}
            onClosed={closed} onAction={fn()} />
        </>
      ) : null}
      <button
        type="button"
        className="sr-only"
        onClick={() => {
          setIsOpen(false);
          setSelected(null);
          flushSync(() => setMounted(false));
          queueMicrotask(() => setMounted(true));
        }}
      >
        Reload fixture
      </button>
    </main>
  );
}
const meta = {
  id: "journeys-activity-ledger",
  title: "Journeys/Activity ledger",
  component: Journey,
  parameters: { viewport: { defaultViewport: "mobile" } },
} satisfies Meta<typeof Journey>;
export default meta;
type Story = StoryObj<typeof meta>;
export const PendingToDetailAndBack: Story = {
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const pending = screen.getByRole("list", { name: "Pending" });
    const fundingRow = within(pending).getByRole("button", { description: /View Add money details/ });
    await expect(fundingRow).toHaveAccessibleName(/Action needed/);
    await expect(within(pending).getByRole("button", { description: /View Sent to alex.base.eth details/ }))
      .not.toHaveAccessibleName(/Action needed/);
    await expect(pending.closest('[data-slot="card"]'))
      .not.toBe(screen.getByRole("list", { name: "Recent" }).closest('[data-slot="card"]'));
    await userEvent.click(fundingRow);
    await expect(await screen.findByRole("dialog")).toBeVisible();
    await expect(screen.getByRole("button", { name: "Continue payment" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Close Add money details" }));
    await waitFor(() => expect(fundingRow).toHaveFocus());
    const transferRow = within(pending).getByRole("button", {
      description: /View Sent to alex.base.eth details/,
    });
    await userEvent.click(transferRow);
    await expect(await screen.findByRole("dialog")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(transferRow).toHaveFocus());
  },
};
export const ReloadRestoresPending: Story = {
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const firstRow = () => within(screen.getByRole("list", { name: "Pending" }))
      .getAllByRole("button")[0]!;
    await expect(firstRow()).toHaveTextContent("Add money");
    await expect(firstRow()).toHaveAccessibleName(/Action needed/);
    await userEvent.click(screen.getByRole("button", { name: "Reload fixture" }));
    await waitFor(() => expect(firstRow()).toHaveAccessibleName(/Action needed/));
    await expect(firstRow()).toHaveTextContent("Add money");
    await expect(screen.queryByRole("dialog")).toBeNull();
  },
};
