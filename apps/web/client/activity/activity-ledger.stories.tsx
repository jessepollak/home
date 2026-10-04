import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect, useRef, useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { PORTFOLIO_USDC_ASSET_KEY, assetKeyForErc20 } from "@/config/portfolio-assets";
import { Card, CardContent } from "@/components/ui/card";
import {
  ActivityLedger,
  type ActivityLedgerEntry,
  type ActivityLedgerItem,
} from "./activity-ledger";
import { ActivityLedgerDetailSheet } from "./activity-ledger-sheet";
import { presentActivityLedgerItems } from "./activity-ledger-items";
import type { CardPurchase } from "@/shared/cards/transactions-contract";

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
  secondaryAction: { kind: "cancel-order", label: "Cancel deposit" },
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
function cardPurchaseItem(purchase: CardPurchase): ActivityLedgerItem {
  const item = { kind: "card" as const, id: purchase.id, timestamp: purchase.createdAt, purchase };
  const [ledgerItem] = presentActivityLedgerItems([item], { regionId: "US" });
  if (!ledgerItem) throw new Error("Card purchase fixture did not present");
  return ledgerItem;
}

const cardPendingPurchase: CardPurchase = { id: "iauth_fixturebluebottle", kind: "authorization", amountMinor: "650", merchantName: "Blue Bottle Coffee", status: "pending", declineReasonCode: null,
    currency: "USD", merchantCategory: null, createdAt: "2026-09-24T10:30:00.000Z", updatedAt: "2026-09-24T10:30:00.000Z" };
const cardDeclinedLockedPurchase: CardPurchase = { id: "iauth_fixturelyft", kind: "authorization", amountMinor: "1820", merchantName: "Lyft", status: "declined", declineReasonCode: "card_inactive",
    currency: "USD", merchantCategory: null, createdAt: "2026-09-19T14:00:00.000Z", updatedAt: "2026-09-19T14:00:00.000Z" };
const cardDeclinedInsufficientPurchase: CardPurchase = { id: "iauth_fixturewholefoodsdeclined", kind: "authorization", amountMinor: "6410", merchantName: "Whole Foods Market", status: "declined", declineReasonCode: "insufficient_funds",
    currency: "USD", merchantCategory: null, createdAt: "2026-09-19T13:30:00.000Z", updatedAt: "2026-09-19T13:30:00.000Z" };
const cardCompletedPurchase: CardPurchase = { id: "ipi_fixturewholefoods", kind: "transaction", amountMinor: "4218", merchantName: "Whole Foods Market", status: "completed", declineReasonCode: null,
    currency: "USD", merchantCategory: null, createdAt: "2026-09-21T14:00:00.000Z", updatedAt: "2026-09-21T14:00:00.000Z" };
const cardReversedPurchase: CardPurchase = { id: "ipi_fixturegrandhotel", kind: "transaction", amountMinor: "10000", merchantName: "Grand Hotel", status: "reversed", declineReasonCode: null,
    currency: "USD", merchantCategory: null, createdAt: "2026-09-23T06:30:00.000Z", updatedAt: "2026-09-23T06:30:00.000Z" };
const cardRefundedPurchase: CardPurchase = { id: "ipi_fixtureapple", kind: "transaction", amountMinor: "999", merchantName: "Apple", status: "refunded", declineReasonCode: null,
    currency: "USD", merchantCategory: null, createdAt: "2026-09-23T06:00:00.000Z", updatedAt: "2026-09-23T06:00:00.000Z" };
const pendingCard = cardPurchaseItem(cardPendingPurchase);
const declined = cardPurchaseItem(cardDeclinedLockedPurchase);
const declinedInsufficient = cardPurchaseItem(cardDeclinedInsufficientPurchase);
const card = cardPurchaseItem(cardCompletedPurchase);
const cardReversed = cardPurchaseItem(cardReversedPurchase);
const refunded = cardPurchaseItem(cardRefundedPurchase);
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
  funding, transfer, pendingCard, provider, borrowed, reversed, cardReversed, refunded,
  card, failed, expired, ambiguous, declined, declinedInsufficient, received,
];

function Surface({
  items = fixtures,
  initial,
  pendingLabel,
  recentLabel,
  layout = "page",
  canOpenAsset,
  onOpenAsset,
}: {
  items?: ActivityLedgerEntry[];
  initial?: ActivityLedgerItem;
  pendingLabel?: string;
  recentLabel?: string;
  layout?: "page" | "feed";
  canOpenAsset?: (assetKey: string) => boolean;
  onOpenAsset?: (item: ActivityLedgerItem) => void;
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
        onClosed={closed} onAction={fn()} canOpenAsset={canOpenAsset} onOpenAsset={onOpenAsset} />
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
const withItems = (items: ActivityLedgerEntry[]): Story => ({
  render: () => <Surface items={items} />,
});
const detail = (item: ActivityLedgerItem, options: {
  canOpenAsset?: (assetKey: string) => boolean;
  onOpenAsset?: (item: ActivityLedgerItem) => void;
} = {}): Story => ({
  render: () => <Surface initial={item} items={[item]} {...options} />,
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(await screen.findByRole("dialog")).toBeVisible();
    const number = screen.getByRole("dialog").querySelector('[data-slot="activity-amount-number"]');
    await expect(number).toHaveTextContent(item.detailAmountParts?.amount ?? item.detailAmount ?? item.amount);
    const dialog = within(screen.getByRole("dialog"));
    if (item.statusLabel) {
      for (const label of dialog.getAllByText(item.statusLabel, { exact: true })) await expect(label).toBeVisible();
    }
    if (item.detailValue !== undefined) {
      await expect(dialog.getByText(item.detailValue)).toBeVisible();
      await expect(dialog.queryByRole("term", { name: "Value" })).toBeNull();
    }
    if (item.detailAsset) {
      await expect(dialog.getByText(item.detailAsset.name)).toBeVisible();
      if (item.detailAsset.openable && options.onOpenAsset && options.canOpenAsset?.(item.detailAsset.assetKey)) {
        await expect(dialog.getByRole("button", { name: new RegExp(item.detailAsset.name) })).toBeVisible();
      } else {
        await expect(dialog.queryByRole("button", { name: new RegExp(item.detailAsset.name) })).toBeNull();
      }
    }
    if (item.secondaryAction?.kind === "cancel-order" && item.status === "waiting-customer") {
      await expect(dialog.getByRole("button", { name: item.secondaryAction.label })).toBeVisible();
    }
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
    await expect(pendingRows).toHaveLength(7);
    await expect(recentRows).toHaveLength(8);
    const titles = ["Add money", "Cash out to bank", "Sent to alex.base.eth", "Blue Bottle Coffee", "Add money", "Borrowed USDC", "Send"];
    for (const [index, row] of pendingRows.entries()) {
      await expect(row).toHaveTextContent(titles[index]!);
    }
    await expect(within(pending).getAllByRole("button", { name: /Action needed/ }))
      .toEqual(pendingRows.slice(0, 2));
    await expect(within(recent).queryByRole("button", { name: /Action needed/ })).toBeNull();
    await expect(pendingRows[0]).toHaveTextContent("Today");
    await expect(pendingRows[1]).toHaveTextContent("Yesterday · Reversed");
    await expect(pendingRows[6]).toHaveTextContent("Sep 20");
    await expect(pendingRows[6]).not.toHaveTextContent(" · ");
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
export const PendingByOwner = withItems([funding, provider, transfer, borrowed, pendingCard]);
export const TerminalStates: Story = {
  ...withItems([received, failed, expired, ambiguous, reversed, refunded, card, cardReversed, declined, declinedInsufficient]),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const recent = within(canvas.getByRole("list", { name: "Recent" }));
    for (const item of [refunded, card, cardReversed, declined, declinedInsufficient]) {
      const statusLabel = item.statusLabel;
      if (!statusLabel) throw new Error("Missing card status label");
      await expect(recent.getByRole("button", { description: item.activateLabel, name: new RegExp(statusLabel) })).toHaveTextContent(statusLabel);
    }
  },
};
const usdcAsset = { assetKey: PORTFOLIO_USDC_ASSET_KEY, name: "US dollar", symbol: "USDC", openable: true };
const bitcoinAsset = { assetKey: assetKeyForErc20("0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf"),
  name: "Bitcoin", symbol: "cbBTC", openable: true };
const pricedReceived: ActivityLedgerItem = {
  ...received, amount: "+$91.50", detailAmountParts: { amount: "+0.001", symbol: "cbBTC" },
  detailValue: "+$91.50", detailAsset: bitcoinAsset,
};
export const DetailReceived = detail(pricedReceived, { canOpenAsset: () => true, onOpenAsset: fn() });
export const DetailSent = detail({ ...transfer, status: "confirmed", detailAmountParts: { amount: "−25.00", symbol: "USDC" },
  detailValue: "−$25.00", detailAsset: usdcAsset });
export const DetailTinyAmount = detail({ ...pricedReceived, id: "tiny", detailAmountParts: {
  amount: "+<0.000001", symbol: "cbBTC",
}, detailValue: "+<$0.01" });
export const DetailLargeAmount = detail({ ...pricedReceived, id: "large", detailAmountParts: {
  amount: "+123,456,789.12", symbol: "cbBTC",
}, detailValue: "+$12,345,678.90" });
export const DetailUnknownValue = detail({ ...pricedReceived, id: "unknown", detailValue: "Unknown" });
export const DetailEuroValue = detail({ ...pricedReceived, id: "euro", detailValue: "+€91.50" });
export const DetailLongAssetNameMissingImage = detail({ ...pricedReceived, id: "long-asset",
  detailAsset: { assetKey: assetKeyForErc20("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    name: "An exceptionally long asset name that needs to remain readable", symbol: "LO", openable: true,
    imageUrl: null } });
export const DetailTrade: Story = {
  ...detail({ ...borrowed, id: "trade", title: "Bought Bitcoin", status: "confirmed",
    amount: "−$100.00", detailAmountParts: { amount: "−100.00", symbol: "USDC" },
    detail: { family: "home-action", operation: "Buy Bitcoin", network: "Base", facts: [
      { label: "You pay", value: "100.00 USDC" }, { label: "You receive", value: "0.001 cbBTC" },
    ] } }),
  play: async ({ canvasElement }) => {
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog"));
    await expect(dialog.getByText("100.00 USDC")).toBeVisible();
    await expect(dialog.getByText("0.001 cbBTC")).toBeVisible();
    await expect(dialog.queryByText("Asset")).toBeNull();
    await expect(dialog.queryByRole("term", { name: "Value" })).toBeNull();
  },
};
export const DetailTradeWithServiceFee: Story = {
  ...detail({ ...borrowed, id: "trade-service-fee", title: "Sold Bitcoin", status: "confirmed",
    amount: "−0.001 cbBTC", detailAmountParts: { amount: "−0.001", symbol: "cbBTC" },
    detail: { family: "home-action", operation: "Sell Bitcoin", network: "Base", facts: [
      { label: "You receive", value: "Estimated 99.50 USDC" }, { label: "Service fee", value: "$0.50 (0.5%)" },
    ] } }),
  play: async ({ canvasElement }) => {
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog"));
    await expect(dialog.getByText("Estimated 99.50 USDC")).toBeVisible();
    await expect(dialog.getByText("Service fee")).toBeVisible();
    await expect(dialog.getByText("$0.50 (0.5%)")).toBeVisible();
  },
};
export const DetailFundingNeedsYou = detail(funding);
export const DetailFundingCancelled = detail({ ...funding, id: "funding-cancelled", status: "failed", statusLabel: "Cancelled",
  nextAction: undefined, secondaryAction: undefined, steps: [], ownerSentence: { title: "Deposit cancelled",
    description: "If you already paid, the money will still show up here when it arrives." } });
export const DetailFundingTimedOut = detail({ ...funding, id: "funding-timed-out", status: "expired", statusLabel: "Timed out",
  nextAction: undefined, secondaryAction: undefined, steps: [], ownerSentence: { title: "Checkout timed out",
    description: "If you already paid, the money will still show up here when it arrives." } });
export const DetailFundingPaymentReceived = detail({ ...provider, secondaryAction: undefined,
  ownerSentence: { title: "Payment received", description: "Coinbase is processing your payment. Home will show the money when it arrives on Base." } });
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
export const DetailCardPending = detail(pendingCard);
export const DetailCardCompleted = detail(card);
export const DetailCardDeclinedLocked = detail(declined);
export const DetailCardDeclinedInsufficient = detail(declinedInsufficient);
export const DetailCardReversed = detail(cardReversed);
export const DetailExpired = detail(expired);
export const NothingPending: Story = {
  ...withItems([refunded, card, failed, expired, declined, declinedInsufficient, cardReversed, received]),
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
function DoubleText({ items }: { items: ActivityLedgerEntry[] }) {
  useEffect(() => {
    const previous = document.documentElement.style.fontSize;
    document.documentElement.style.fontSize = "200%";
    return () => { document.documentElement.style.fontSize = previous; };
  }, []);
  return <Surface items={items} />;
}
export const TwoHundredPercentText: Story = { render: () => <DoubleText items={[funding, received]} /> };
export const Mobile320: Story = {
  ...withItems([funding, transfer, refunded]),
  parameters: { viewport: { defaultViewport: "smallMobile" } },
};
export const DetailLongExactAmount: Story = {
  render: () => {
    const long = { ...received, id: "transfer-long",
      detailAmount: "+123456789012345678901234567.123456789012345678 LONGSYMBOLTOKEN",
      detailAmountParts: { amount: "+123456789012345678901234567.123456789012345678", symbol: "LONGSYMBOLTOKEN" } };
    return <Surface initial={long} items={[long]} />;
  },
  parameters: { viewport: { defaultViewport: "smallMobile" } },
  play: async ({ canvasElement }) => {
    const dialog = await within(canvasElement.ownerDocument.body).findByRole("dialog");
    const number = dialog.querySelector<HTMLElement>('[data-slot="activity-amount-number"]');
    const scroll = dialog.querySelector<HTMLElement>('[data-slot="activity-amount-scroll"]');
    const unit = dialog.querySelector<HTMLElement>('[data-slot="activity-amount-unit"]');
    if (!number || !scroll || !unit) throw new Error("Missing split amount headline");
    await expect(unit).toHaveTextContent("LONGSYMBOLTOKEN");
    await waitFor(async () => {
      await expect(scroll).toHaveAttribute("tabindex", "0");
      await expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth);
    });
    await expect(number.getClientRects().length).toBe(1);
    const bounds = dialog.getBoundingClientRect();
    await expect(scroll.getBoundingClientRect().left).toBeGreaterThanOrEqual(bounds.left);
    await expect(scroll.getBoundingClientRect().right).toBeLessThanOrEqual(bounds.right);
  },
};
export const Desktop: Story = {
  ...detail(funding),
  render: () => <Surface initial={funding} items={fixtures} />,
  parameters: { viewport: { defaultViewport: "desktop" } },
};
export const ReducedMotionReference: Story = { render: () => <Surface items={[funding]} /> };

function syntheticTransfer(id: string, title: string, amount: string, symbol: string): ActivityLedgerItem {
  return {
    id: `synthetic-${id}`,
    family: "onchain-transfer",
    status: "confirmed",
    timestamp: "2026-09-24T12:00:00.000Z",
    dateLabel: "Sep 24",
    fullDateLabel: "Sep 24, 2026, 12:00 PM",
    title,
    amount,
    direction: "in",
    mark: { kind: "asset", symbol },
    detail: {
      family: "onchain-transfer",
      counterpartyLabel: "From",
      counterparty: "0x0000000000000000000000000000000000000001",
      network: "Base",
    },
  };
}

const pricedChildren = [
  syntheticTransfer("usdc-a", "Received", "+$4.00", "USDC"),
  { ...syntheticTransfer("usdc-b", "Received", "+$6.00", "USDC"),
    timestamp: "2026-09-22T12:00:00.000Z", dateLabel: "Sep 22", fullDateLabel: "Sep 22, 2026, 12:00 PM" },
];
const unpricedChildren = [
  syntheticTransfer("mystery-a", "Received", "+2.00 TEST", "TEST"),
  syntheticTransfer("mystery-b", "Received", "+3.00 TEST", "TEST"),
];
function syntheticGroup(children: readonly ActivityLedgerItem[], symbol: string, amount: string, amountContext?: string, title = "Received"): ActivityLedgerEntry {
  return {
    kind: "group",
    id: `transfer-run:${children[0]!.id}`,
    title,
    countLabel: `${children.length} transfers`,
    count: children.length,
    newestTimestamp: children[0]!.timestamp,
    oldestTimestamp: children[children.length - 1]!.timestamp,
    rangeLabel: children[0]!.dateLabel === children[children.length - 1]!.dateLabel
      ? children[0]!.dateLabel : `${children[children.length - 1]!.dateLabel} – ${children[0]!.dateLabel}`,
    fullRangeLabel: `${children[children.length - 1]!.fullDateLabel} – ${children[0]!.fullDateLabel}`,
    amount,
    amountContext,
    direction: "in",
    mark: { kind: "asset", symbol },
    toggleLabel: `${children.length} ${title} ${symbol} transfers`,
    children,
  };
}

const groupedMix: ActivityLedgerEntry[] = [
  syntheticGroup(pricedChildren, "USDC", "+$10.00", "+10.00 USDC"),
  syntheticTransfer("btc", "Received", "+0.01 BTC", "BTC"),
  syntheticTransfer("usdc-separated", "Received", "+$1.00", "USDC"),
  syntheticGroup(unpricedChildren, "TEST", "+5.00 TEST"),
];

export const ConsecutiveTransfersMobile: Story = {
  render: () => <Surface items={groupedMix} layout="feed" />,
  parameters: { viewport: { defaultViewport: "mobile" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const screen = within(canvasElement.ownerDocument.body);
    const summary = canvas.getByRole("button", { description: "2 Received USDC transfers" });
    summary.focus();
    await userEvent.keyboard("{Enter}");
    await expect(summary).toHaveAttribute("aria-expanded", "true");
    const listId = summary.getAttribute("aria-controls");
    if (!listId) throw new Error("Expanded run did not identify its recent list");
    const list = canvasElement.ownerDocument.getElementById(listId);
    if (!list || list !== summary.closest("ul")) throw new Error("Expanded run did not control its mounted list");
    const children = within(list).getAllByRole("button", { description: "View Received details" });
    await expect(children).toHaveLength(4);
    const child = children[0]!;
    await waitFor(() => expect(child).toBeVisible());
    await userEvent.click(child);
    await expect(await screen.findByRole("dialog", { name: "Received" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Close Received details" }));
    await waitFor(() => expect(child).toHaveFocus());
    summary.focus();
    await userEvent.keyboard(" ");
    await expect(summary).toHaveAttribute("aria-expanded", "false");
    await expect(summary).not.toHaveAttribute("aria-controls");
    await expect(canvasElement.ownerDocument.getElementById(listId)).toBe(list);
    await expect(child.isConnected).toBe(false);
    await expect(within(list).getAllByRole("button", { description: "View Received details" })).toHaveLength(2);
  },
};

export const ConsecutiveTransfersDesktop: Story = {
  render: () => <Surface items={groupedMix} />,
  parameters: { viewport: { defaultViewport: "desktop" } },
};

export const LongTransferRun: Story = {
  render: () => <Surface items={[syntheticGroup(
    Array.from({ length: 40 }, (_, index) => syntheticTransfer(`long-${index}`, "Received", "+$1.00", "USDC")),
    "USDC", "+$40.00", "+40.00 USDC",
  )]} />,
  parameters: { viewport: { defaultViewport: "smallMobile" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const summary = canvas.getByRole("button", { description: "40 Received USDC transfers" });
    await userEvent.click(summary);
    await expect(canvas.getAllByRole("button", { description: "View Received details" }).length).toBeLessThan(40);
    await expect(canvas.getAllByRole("button", { description: "View Received details" }).length).toBeGreaterThan(0);
  },
};

const groupedLabelItems: ActivityLedgerEntry[] = [
  syntheticGroup(Array.from({ length: 8 }, (_, index) => syntheticTransfer(`width-received-${index}`, "Received", "+$1,543.21", "USDC")),
    "USDC", "+$12,345.67", "+12,345.678901 USDC"),
  syntheticTransfer("width-single", "Received", "+$12,345.67", "USDC"),
  syntheticGroup(Array.from({ length: 2 }, (_, index) => syntheticTransfer(`width-local-${index}`, "Recibido", "+$1,543.21", "USDC")),
    "USDC", "+$12,345.67", "+12,345.678901 USDC", "Recibido"),
  syntheticGroup(Array.from({ length: 128 }, (_, index) => index === 127
    ? { ...syntheticTransfer(`width-range-${index}`, "Empfangen", "+$1.00", "USDC"), timestamp: "2026-09-22T12:00:00.000Z", dateLabel: "Sep 22", fullDateLabel: "Sep 22, 2026, 12:00 PM" }
    : syntheticTransfer(`width-range-${index}`, "Empfangen", "+$1.00", "USDC")),
    "USDC", "+$12,345.67", "+12,345.678901 USDC", "Empfangen"),
  syntheticGroup(Array.from({ length: 2 }, (_, index) => syntheticTransfer(`width-symbol-${index}`, "Received", "+$1.00", "ANEXCEPTIONALLYLONGTOKENNAME")),
    "ANEXCEPTIONALLYLONGTOKENNAME", "+$2.00", "+2.00 ANEXCEPTIONALLYLONGTOKENNAME"),
];

async function checkGroupedLabels(canvasElement: HTMLElement, expectPairs = false) {
  const canvas = within(canvasElement);
  const summaries = canvas.getAllByRole("button", { description: /transfers$/ });
  await expect(summaries).toHaveLength(4);
  await expect(canvas.getAllByRole("button", { description: "View Received details" }).length).toBeGreaterThan(0);
  for (const summary of summaries) {
    const row = summary.closest<HTMLElement>("li");
    const body = summary.querySelector<HTMLElement>('[data-slot="finance-row-body"]');
    const title = body?.querySelector<HTMLElement>('[data-slot="item-title"]');
    const label = title?.querySelector<HTMLElement>("span > span:first-child");
    const count = title?.querySelector<HTMLElement>('[aria-hidden="true"]');
    const context = body?.querySelector<HTMLElement>('[data-slot="finance-row-label"] [data-slot="item-description"]');
    const value = body?.querySelector<HTMLElement>('[data-slot="finance-row-value"]');
    const fiat = value?.querySelector<HTMLElement>('[data-slot="item-title"]');
    const native = value?.querySelector<HTMLElement>('[data-slot="item-description"]');
    if (!row || !body || !title || !label || !count || !context || !value || !fiat || !native) throw new Error("Missing grouped row geometry");
    const bounds = summary.getBoundingClientRect();
    const bodyBounds = body.getBoundingClientRect();
    const labelBounds = label.getBoundingClientRect();
    const countBounds = count.getBoundingClientRect();
    const titleBounds = title.getBoundingClientRect();
    const contextBounds = context.getBoundingClientRect();
    const fiatBounds = fiat.getBoundingClientRect();
    const nativeBounds = native.getBoundingClientRect();
    const inlineEnd = (rect: DOMRect) => summary.closest('[dir="rtl"]') ? rect.left : rect.right;
    await expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth + 1);
    await expect(countBounds.width).toBeGreaterThan(0);
    for (const rect of [labelBounds, countBounds, fiatBounds, nativeBounds]) {
      await expect(rect.left).toBeGreaterThanOrEqual(bodyBounds.left - 1);
      await expect(rect.right).toBeLessThanOrEqual(bodyBounds.right + 1);
    }
    await expect(fiat.scrollWidth).toBeLessThanOrEqual(fiat.clientWidth + 1);
    await expect(context.scrollWidth).toBeLessThanOrEqual(context.clientWidth + 1);
    await expect(Math.abs(inlineEnd(fiatBounds) - inlineEnd(nativeBounds))).toBeLessThanOrEqual(1);
    await expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
    await expect(bodyBounds.left).toBeGreaterThanOrEqual(bounds.left - 1);
    await expect(bodyBounds.right).toBeLessThanOrEqual(bounds.right + 1);
    if (!native.textContent?.includes("ANEXCEPTIONALLYLONGTOKENNAME")) {
      await expect(native.scrollWidth).toBeLessThanOrEqual(native.clientWidth + 1);
    }
    if (expectPairs && context.querySelector("time")?.textContent === "Sep 24" && !native.textContent?.includes("ANEXCEPTIONALLYLONGTOKENNAME")) {
      await expect(Math.min(titleBounds.bottom, fiatBounds.bottom) - Math.max(titleBounds.top, fiatBounds.top)).toBeGreaterThan(0);
      await expect(Math.min(contextBounds.bottom, nativeBounds.bottom) - Math.max(contextBounds.top, nativeBounds.top)).toBeGreaterThan(0);
    }
  }
}

const groupedLabels = (viewport: "smallMobile" | "label375" | "label430"): Story => ({
  render: () => <Surface items={groupedLabelItems} />,
  parameters: { viewport: { defaultViewport: viewport } },
  play: async ({ canvasElement }) => checkGroupedLabels(canvasElement, viewport !== "smallMobile"),
});
export const GroupedLabels320 = groupedLabels("smallMobile");
export const GroupedLabels375 = groupedLabels("label375");
export const GroupedLabelsRtl375: Story = {
  render: () => <div dir="rtl"><Surface items={groupedLabelItems} /></div>,
  parameters: { viewport: { defaultViewport: "label375" } },
  play: async ({ canvasElement }) => checkGroupedLabels(canvasElement, true),
};
export const GroupedLabels430 = groupedLabels("label430");

export const GroupedLabelsDoubleText: Story = {
  render: () => <DoubleText items={groupedLabelItems} />,
  parameters: { viewport: { defaultViewport: "label430" } },
  play: async ({ canvasElement }) => checkGroupedLabels(canvasElement),
};
export const GroupedLabelsExpanded: Story = {
  ...groupedLabels("label375"),
  play: async ({ canvasElement }) => {
    const summary = within(canvasElement).getByRole("button", { description: "8 Received USDC transfers" });
    await userEvent.click(summary);
    await expect(summary).toHaveAttribute("aria-expanded", "true");
    await expect(within(canvasElement).getAllByRole("button", { description: "View Received details" }).length).toBeGreaterThan(0);
    await checkGroupedLabels(canvasElement);
  },
};

export const LongSymbolTransferDescription: Story = {
  render: () => <Surface items={[syntheticGroup(
    [syntheticTransfer("long-symbol-a", "Received", "+$1.00", "ANEXCEPTIONALLYLONGTOKENNAME"),
      syntheticTransfer("long-symbol-b", "Received", "+$1.00", "ANEXCEPTIONALLYLONGTOKENNAME")],
    "ANEXCEPTIONALLYLONGTOKENNAME", "+$2.00", "+2.00 ANEXCEPTIONALLYLONGTOKENNAME",
  )]} />,
  parameters: { viewport: { defaultViewport: "mobile" } },
  play: async ({ canvasElement }) => {
    const summary = within(canvasElement).getByRole("button", {
      description: "2 Received ANEXCEPTIONALLYLONGTOKENNAME transfers",
    });
    await expect(summary).toBeVisible();
    await expect(summary).toHaveTextContent("Received ×2");
    await expect(summary.querySelector('[data-slot="item-title"]')).not.toHaveTextContent("ANEXCEPTIONALLYLONGTOKENNAME");
    const title = summary.querySelector<HTMLElement>('[data-slot="item-title"]');
    const count = title?.querySelector<HTMLElement>('[aria-hidden="true"]');
    if (!title || !count) throw new Error("Summary title or count is missing");
    await expect(count.getBoundingClientRect().width).toBeGreaterThan(0);
    await expect(count.getBoundingClientRect().right).toBeLessThanOrEqual(title.getBoundingClientRect().right + 1);
    await expect(count.getBoundingClientRect().top).toBeGreaterThanOrEqual(title.getBoundingClientRect().top);
    await expect(count.getBoundingClientRect().bottom).toBeLessThanOrEqual(title.getBoundingClientRect().bottom + 1);
  },
};
