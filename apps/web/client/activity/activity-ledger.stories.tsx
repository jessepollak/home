import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect, useRef, useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { PORTFOLIO_USDC_ASSET_KEY } from "@/config/portfolio-assets";
import { Card, CardContent } from "@/components/ui/card";
import {
  ActivityLedger,
  type ActivityLedgerItem,
} from "./activity-ledger";
import { ActivityLedgerDetailSheet } from "./activity-ledger-sheet";

const funding: ActivityLedgerItem = {
  id: "funding-1",
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
    orderId: "order-funding-1",
  },
};
const transfer: ActivityLedgerItem = {
  id: "transfer-1",
  family: "onchain-transfer",
  status: "waiting-chain",
  timestamp: "2026-09-24T11:00:00.000Z",
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
    transaction: {
      value: `0x${"a".repeat(64)}`,
      display: "0xaaaa…aaaa",
      explorer: { href: "https://basescan.org/tx/0xaaaa", label: "View on explorer" },
    },
  },
};
const provider: ActivityLedgerItem = {
  ...funding,
  id: "funding-2",
  status: "waiting-provider",
  timestamp: "2026-09-24T10:00:00.000Z",
  amount: "$120.00",
  nextAction: undefined,
  ownerSentence: undefined,
  steps: [
    { status: "complete", title: "Order created", time: "Sep 23, 9:02 AM" },
    { status: "complete", title: "Your bank payment", time: "Payment received" },
    { status: "current", title: "Added to your balance", time: "Waiting on Coinbase" },
  ],
};
const borrowed: ActivityLedgerItem = {
  id: "action-1",
  family: "home-action",
  status: "waiting-home",
  timestamp: "2026-09-24T09:00:00.000Z",
  dateLabel: "Today",
  title: "Borrowed USDC",
  amount: "+$30.00",
  direction: "in",
  mark: { kind: "glyph", glyph: "borrow" },
  detail: { family: "home-action", operation: "Borrow", network: "Base" },
};
const reversed: ActivityLedgerItem = {
  id: "cashout-1",
  family: "cash-out-order",
  status: "reversed",
  timestamp: "2026-09-23T07:05:00.000Z",
  dateLabel: "Yesterday",
  title: "Cash out to bank",
  amount: "−$60.00",
  direction: "out",
  mark: { kind: "glyph", glyph: "cash" },
  ownerSentence: {
    title: "Your bank sent $60.00 back",
    description: "Withdraw it to your balance.",
  },
  steps: [
    { status: "complete", title: "Sent from your balance", time: "Sep 22, 8:10 AM" },
    { status: "complete", title: "Provider paid out", time: "Sep 22, 8:31 AM" },
    { status: "failed", title: "Returned by your bank", time: "Sep 23, 7:05 AM" },
  ],
  nextAction: { kind: "withdraw-returned-funds", label: "Withdraw $60.00" },
  detail: {
    family: "cash-out-order",
    provider: "Peer",
    payoutMethod: "Bank •••• 4821",
    orderId: "cashout-1",
  },
};
const refunded: ActivityLedgerItem = {
  id: "card-refund-1",
  family: "card",
  status: "refunded",
  timestamp: "2026-09-23T06:00:00.000Z",
  dateLabel: "Yesterday",
  title: "Card refund · Blue Bottle",
  amount: "+$6.50",
  direction: "in",
  mark: { kind: "glyph", glyph: "card" },
  detail: {
    family: "card",
    merchant: "Blue Bottle",
    cardLabel: "Home card •••• 1234",
    originalPurchase: "Sep 21 · −$6.50",
  },
};
const card: ActivityLedgerItem = {
  ...refunded,
  id: "card-1",
  status: "confirmed",
  timestamp: "2026-09-21T14:00:00.000Z",
  dateLabel: "Sep 21",
  title: "Card · Blue Bottle",
  amount: "−$6.50",
  direction: "out",
};
const failed: ActivityLedgerItem = {
  id: "action-failed",
  family: "home-action",
  status: "failed",
  timestamp: "2026-09-21T13:00:00.000Z",
  dateLabel: "Sep 21",
  title: "Deposit to Savings",
  amount: "$100.00",
  direction: "none",
  mark: { kind: "glyph", glyph: "savings" },
  ownerSentence: {
    title: "Couldn't deposit $100.00",
    description: "Your balance didn't change.",
  },
  nextAction: { kind: "retry", label: "Try again" },
  detail: {
    family: "home-action",
    operation: "Deposit to Savings",
    from: "Cash",
    network: "Base",
  },
};
const expired: ActivityLedgerItem = {
  ...funding,
  id: "funding-expired",
  status: "expired",
  timestamp: "2026-09-20T14:00:00.000Z",
  dateLabel: "Sep 20",
  amount: "$75.00",
  steps: [],
  nextAction: { kind: "start-again", label: "Start again" },
  ownerSentence: { title: "This order expired", description: "No money moved." },
};
const ambiguous: ActivityLedgerItem = {
  ...transfer,
  id: "transfer-ambiguous",
  status: "ambiguous",
  timestamp: "2026-09-20T13:00:00.000Z",
  dateLabel: "Sep 20",
  title: "Send",
  amount: "$40.00",
  ownerSentence: {
    title: "$40.00 may have left your balance",
    description: "Don't send again until this updates.",
  },
  nextAction: undefined,
};
const declined: ActivityLedgerItem = {
  ...card,
  id: "card-declined",
  status: "failed",
  timestamp: "2026-09-19T14:00:00.000Z",
  dateLabel: "Sep 19",
  title: "Card · Corner Store",
  amount: "$12.00",
  detail: { family: "card", merchant: "Corner Store", cardLabel: "Home card •••• 1234" },
};
const received: ActivityLedgerItem = {
  ...transfer,
  id: "transfer-received",
  status: "confirmed",
  timestamp: "2026-09-19T13:00:00.000Z",
  dateLabel: "Sep 19",
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
const ambiguousFunding: ActivityLedgerItem = {
  ...funding,
  id: "funding-ambiguous",
  status: "ambiguous",
  steps: [],
  ownerSentence: {
    title: "Your payment may have gone through",
    description: "Don't pay again until this updates.",
  },
  nextAction: { kind: "clear-order", label: "Clear old order" },
};
const fixtures = [
  funding, transfer, provider, borrowed, reversed, refunded,
  card, failed, expired, ambiguous, declined, received,
];

function Surface({
  items = fixtures,
  initial,
  pendingLabel,
  recentLabel,
  layout = "page",
}: {
  items?: ActivityLedgerItem[];
  initial?: ActivityLedgerItem;
  pendingLabel?: string;
  recentLabel?: string;
  layout?: "page" | "feed";
}) {
  const [selected, setSelected] = useState<ActivityLedgerItem | null>(initial ?? null);
  const [isOpen, setIsOpen] = useState(Boolean(initial));
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
      <h1 className="sr-only">Activity ledger</h1>
      <h2 className="sr-only">Activity</h2>
      {layout === "feed" ? (
        <Card>
          <CardContent inset="list">
            <ActivityLedger items={items} onOpen={open} pendingLabel={pendingLabel}
              recentLabel={recentLabel} layout="feed" />
          </CardContent>
        </Card>
      ) : (
        <ActivityLedger items={items} onOpen={open} pendingLabel={pendingLabel}
          recentLabel={recentLabel} />
      )}
      <ActivityLedgerDetailSheet item={selected} open={isOpen} onDismiss={() => setIsOpen(false)}
        onClosed={closed} onAction={fn()} />
    </main>
  );
}

const meta = {
  id: "activity-ledger",
  title: "Activity/Ledger",
  component: ActivityLedger,
  args: { items: [], onOpen: () => undefined },
  parameters: { viewport: { defaultViewport: "mobile" }, a11y: { test: "error" } },
} satisfies Meta<typeof ActivityLedger>;
export default meta;
type Story = StoryObj<typeof meta>;
const withItems = (items: ActivityLedgerItem[]): Story => ({
  render: () => <Surface items={items} />,
});
const detail = (item: ActivityLedgerItem): Story => ({
  render: () => <Surface initial={item} items={[item]} />,
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(await screen.findByRole("dialog")).toBeVisible();
    await expect(screen.getByText(item.amount, { selector: "p" })).toBeVisible();
    const allowed = item.nextAction?.label;
    if (allowed) {
      await expect(
        within(screen.getByRole("dialog")).getByRole("button", { name: allowed }),
      ).toBeVisible();
    } else {
      await expect(within(screen.getByRole("dialog")).getAllByRole("button")
        .filter((button) => /^(Continue payment|Try again|Clear old order)$/.test(
          button.textContent ?? "",
        ))).toHaveLength(0);
    }
  },
});
export const MixedChronology: Story = {
  ...withItems(fixtures),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const pending = canvas.getByRole("list", { name: "Pending" });
    const recent = canvas.getByRole("list", { name: "Recent" });
    const pendingRows = within(pending).getAllByRole("button");
    const recentRows = within(recent).getAllByRole("button");
    await expect(pendingRows).toHaveLength(6);
    await expect(recentRows).toHaveLength(6);
    const titles = ["Add money", "Cash out to bank", "Sent to alex.base.eth", "Add money", "Borrowed USDC", "Send"];
    for (const [index, row] of pendingRows.entries()) {
      await expect(row).toHaveTextContent(titles[index]!);
    }
    await expect(within(pending).getAllByRole("button", { name: /Action needed/ }))
      .toEqual(pendingRows.slice(0, 2));
    await expect(within(recent).queryByRole("button", { name: /Action needed/ })).toBeNull();
    await expect(pendingRows[0]).toHaveTextContent("Today");
    await expect(pendingRows[1]).toHaveTextContent("Yesterday · Reversed");
    await expect(pendingRows[5]).toHaveTextContent("Sep 20");
    await expect(pendingRows[5]).not.toHaveTextContent(" · ");
    for (const row of [...pendingRows, ...recentRows]) {
      await expect(row).not.toHaveTextContent(/With |On /);
    }
    const row = within(pending).getByRole("button", {
      description: /View Sent to alex.base.eth details/,
    });
    await userEvent.click(row);
    await expect(await within(canvasElement.ownerDocument.body).findByRole("dialog")).toBeVisible();
    await expect(within(canvasElement.ownerDocument.body).queryByRole("button", {
      name: "Try again",
    })).toBeNull();
    await userEvent.click(within(canvasElement.ownerDocument.body)
      .getByRole("button", { name: "Close Sent to alex.base.eth details" }));
    await waitFor(() => expect(row).toHaveFocus());
  },
};
export const Deduplicated: Story = {
  ...withItems([funding, funding, transfer]),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("list", { name: "Pending" }).querySelectorAll("li"))
      .toHaveLength(2);
  },
};
export const PendingByOwner = withItems([funding, provider, transfer, borrowed]);
export const TerminalStates = withItems([
  received, failed, expired, ambiguous, reversed, refunded, declined,
]);
export const DetailFundingNeedsYou = detail(funding);
export const DetailHomeActionConfirming: Story = {
  ...detail({
    ...borrowed,
    id: "action-confirming",
    status: "waiting-chain",
    title: "Send USDC",
    amount: "−$30.00",
    direction: "out",
    mark: { kind: "asset", assetKey: PORTFOLIO_USDC_ASSET_KEY, symbol: "USDC" },
    detail: { family: "home-action", operation: "Send", network: "Base" },
    steps: [
      { status: "complete", title: "Submitted", time: "Sep 24, 11:07 AM" },
      { status: "current", title: "Confirming on Base" },
    ],
  }),
  play: async ({ canvasElement }) => {
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog"));
    const stages = dialog.getAllByRole("listitem");
    await expect(stages).toHaveLength(2);
    await expect(stages[0]).toHaveTextContent("Complete: Submitted");
    await expect(stages[0]).toHaveTextContent("11:07");
    await expect(stages[1]).toHaveTextContent("In progress: Confirming on Base");
  },
};
export const DetailTransferPending = detail(transfer);
export const DetailAmbiguous: Story = {
  ...detail(ambiguous),
  play: async ({ canvasElement }) => {
    const dialog = await within(canvasElement.ownerDocument.body).findByRole("dialog");
    await expect(within(dialog).getAllByRole("button")).toHaveLength(3);
    await expect(within(dialog).getByText("Unconfirmed")).toBeVisible();
    await expect(within(dialog).getByRole("button", { name: "Close Send details" })).toBeVisible();
    await expect(within(dialog).getByRole("button", { name: /Copy 0xaaaa/ })).toBeVisible();
    await expect(within(dialog).getByRole("button", { name: "Copy alex.base.eth" })).toBeVisible();
  },
};
export const DetailAmbiguousFunding = detail(ambiguousFunding);
export const DetailFailed = detail(failed);
export const DetailCashOutReversed = detail(reversed);
export const DetailCardRefunded = detail(refunded);
export const DetailExpired = detail(expired);
export const NothingPending: Story = {
  ...withItems([refunded, card, failed, expired, declined, received]),
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement);
    await expect(screen.getAllByRole("list")).toHaveLength(1);
    await expect(screen.queryByRole("heading", { name: "Pending" })).toBeNull();
    await expect(screen.queryByRole("heading", { name: "Recent" })).toBeNull();
  },
};
export const HomeFeed: Story = {
  render: () => <Surface items={[funding, transfer, received]} layout="feed" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("list", { name: "Pending" })).toBeVisible();
    await expect(canvas.getByRole("list", { name: "Recent" })).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Recent" })).toBeVisible();
  },
};
export const HomeFeedNothingPending: Story = {
  render: () => <Surface items={[received, refunded]} layout="feed" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole("list")).toHaveLength(1);
    await expect(canvas.queryByRole("heading", { name: "Recent" })).toBeNull();
  },
};
export const LongLocalizedCopy: Story = {
  render: () => (
    <Surface pendingLabel="Ausstehend" recentLabel="Zuletzt" items={[{
      ...funding,
      title: "Ausstehende Überweisung für Ihr langfristiges Sparkonto",
      dateLabel: "Heute",
      statusLabel: "Ihre Mitwirkung erforderlich",
      nextAction: { kind: "complete-payment", label: "Banküberweisung fortsetzen" },
    }, received]} />
  ),
};
function DoubleText() {
  useEffect(() => {
    const previous = document.documentElement.style.fontSize;
    document.documentElement.style.fontSize = "200%";
    return () => { document.documentElement.style.fontSize = previous; };
  }, []);
  return <Surface items={[funding, received]} />;
}
export const TwoHundredPercentText: Story = { render: () => <DoubleText /> };
export const Mobile320: Story = {
  ...withItems([funding, transfer, refunded]),
  parameters: { viewport: { defaultViewport: "smallMobile" } },
};
export const DetailLongExactAmount: Story = {
  render: () => {
    const long = { ...received, id: "transfer-long",
      detailAmount: "+123456789012345678901234567.123456789012345678 LONGSYMBOLTOKEN" };
    return <Surface initial={long} items={[long]} />;
  },
  parameters: { viewport: { defaultViewport: "smallMobile" } },
  play: async ({ canvasElement }) => {
    const dialog = await within(canvasElement.ownerDocument.body).findByRole("dialog");
    const amount = within(dialog).getByText(/LONGSYMBOLTOKEN/);
    await expect(amount).toBeVisible();
    const bounds = dialog.getBoundingClientRect();
    const box = amount.getBoundingClientRect();
    await expect(box.left).toBeGreaterThanOrEqual(bounds.left);
    await expect(box.right).toBeLessThanOrEqual(bounds.right);
    await expect(amount.scrollWidth).toBeLessThanOrEqual(amount.clientWidth);
  },
};
export const Desktop: Story = {
  ...detail(funding),
  render: () => <Surface initial={funding} items={fixtures} />,
  parameters: { viewport: { defaultViewport: "desktop" } },
};
export const ReducedMotionReference: Story = { render: () => <Surface items={[funding]} /> };
