import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import {
  ActivityLedger,
  ActivityNeedsAttention,
  type ActivityLedgerItem,
  type ActivityLedgerNextAction,
} from "./activity-ledger";

const mixedItems: ActivityLedgerItem[] = [
  {
    canonicalId: "funding:idrx:order-2048",
    family: "funding-order",
    title: "Add money by bank transfer",
    exactAmount: "Rp 2.000.000 IDR",
    occurredAt: "2026-09-19T04:12:00.000Z",
    occurredAtLabel: "Today, 11:12",
    status: "waiting-customer",
    nextAction: { kind: "complete-payment", label: "View instructions" },
    detail: {
      family: "funding-order",
      provider: "IDRX",
      paymentMethod: "Mandiri virtual account",
      orderId: "order-2048",
    },
  },
  {
    canonicalId: "action:send:8dcf",
    family: "home-action",
    title: "Sent USDC",
    exactAmount: "−$125.00 USDC",
    occurredAt: "2026-09-19T03:48:00.000Z",
    occurredAtLabel: "Today, 10:48",
    status: "waiting-chain",
    detail: {
      family: "home-action",
      operation: "Send",
      network: "Base",
      actionId: "8dcf…33e1",
      transaction: "0x6b2d…a904",
    },
  },
  {
    canonicalId: "cashout:peer:deposit-77",
    family: "cash-out-order",
    title: "Cash out to Cash App",
    exactAmount: "$80.00 USD",
    occurredAt: "2026-09-18T22:05:00.000Z",
    occurredAtLabel: "Yesterday, 15:05",
    status: "waiting-provider",
    detail: {
      family: "cash-out-order",
      provider: "Peer",
      payoutMethod: "Cash App",
      orderId: "deposit-77",
    },
  },
  {
    canonicalId: "8453:eurc:log-88",
    family: "onchain-transfer",
    title: "Received EURC",
    exactAmount: "+€75.00 EURC",
    occurredAt: "2026-09-18T21:40:00.000Z",
    occurredAtLabel: "Yesterday, 14:40",
    status: "confirmed",
    detail: {
      family: "onchain-transfer",
      network: "Base",
      from: "0x7a21…90c4",
      to: "0x1111…1111",
      transaction: "0xf022…1c08",
    },
  },
  {
    canonicalId: "action:save:4140",
    family: "home-action",
    title: "Deposited to Save",
    exactAmount: "$500.000000 USDC",
    occurredAt: "2026-09-18T20:14:00.000Z",
    occurredAtLabel: "Yesterday, 13:14",
    status: "confirmed",
    correlatedSourceCount: 2,
    detail: {
      family: "home-action",
      operation: "Deposit to Save",
      network: "Base",
      actionId: "4140…e992",
      transaction: "0xa91c…9021",
    },
  },
  {
    canonicalId: "card:future:purchase-9001",
    family: "card",
    title: "Corner Market",
    exactAmount: "−$42.18 USD",
    occurredAt: "2026-09-17T17:02:00.000Z",
    occurredAtLabel: "Sep 17, 10:02",
    status: "refunded",
    detail: {
      family: "card",
      merchant: "Corner Market",
      cardLabel: "Home •••• 4242",
      reference: "purchase-9001",
    },
  },
];

const statusItems: ActivityLedgerItem[] = [
  {
    canonicalId: "funding:verification:customer",
    family: "funding-order",
    title: "Verify your funding account",
    exactAmount: "$250.00 USD",
    occurredAt: "2026-09-19T02:00:00.000Z",
    occurredAtLabel: "Today, 09:00",
    status: "waiting-customer",
    nextAction: { kind: "resume-verification", label: "Resume verification" },
    detail: {
      family: "funding-order",
      provider: "Funding provider",
      paymentMethod: "Bank account",
      orderId: "verification-customer",
    },
  },
  fixture("provider", "Add money", "$250.00 USD", "waiting-provider"),
  fixture("chain", "Trade ETH for USDC", "$100.00 USDC", "waiting-chain"),
  fixture("home", "Repay loan", "$75.00 USDC", "waiting-home"),
  fixture("confirmed", "Received USDC", "+$40.00 USDC", "confirmed"),
  fixture("card-purchase", "Transit Desk", "−$19.20 USD", "confirmed"),
  fixture("card-declined", "Card purchase declined", "−$19.20 USD", "failed"),
  fixture("card-reversed", "Card purchase reversed", "+$19.20 USD", "reversed"),
  fixture("card-refunded", "Card purchase refunded", "+$19.20 USD", "refunded"),
  fixture("expired", "Funding order", "$250.00 USD", "expired"),
  fixture("ambiguous", "Cash out", "$80.00 USD", "ambiguous", {
    kind: "contact-support",
    label: "Contact support",
  }),
  {
    canonicalId: "cashout:peer:reversed-77",
    family: "cash-out-order",
    title: "Cash out reversed",
    exactAmount: "$80.00 USDC",
    occurredAt: "2026-09-19T02:00:00.000Z",
    occurredAtLabel: "Today, 09:00",
    status: "reversed",
    nextAction: { kind: "withdraw-returned-funds", label: "Withdraw returned funds" },
    detail: { family: "cash-out-order", provider: "Peer", payoutMethod: "Cash App", orderId: "deposit-77" },
  },
];

function fixture(
  id: string,
  title: string,
  amount: string,
  status: ActivityLedgerItem["status"],
  nextAction?: ActivityLedgerNextAction,
): ActivityLedgerItem {
  return {
    canonicalId: `fixture:${id}`,
    family: id.startsWith("card-") ? "card" : "home-action",
    title,
    exactAmount: amount,
    occurredAt: "2026-09-19T02:00:00.000Z",
    occurredAtLabel: "Today, 09:00",
    status,
    ...(nextAction ? { nextAction } : {}),
    detail: id.startsWith("card-")
      ? { family: "card", merchant: "Transit Desk", cardLabel: "Home •••• 4242", reference: id }
      : { family: "home-action", operation: title, network: "Base", actionId: `action-${id}` },
  } as ActivityLedgerItem;
}

function LedgerFrame({
  items = mixedItems,
  sourceFailures,
  defaultSelectedId,
}: {
  items?: readonly ActivityLedgerItem[];
  sourceFailures?: { id: string; label: string }[];
  defaultSelectedId?: string;
}) {
  return (
    <main className="mx-auto w-full max-w-2xl p-4 sm:p-8">
      <h1 className="sr-only">Activity ledger proposal</h1>
      <ActivityLedger
        items={items}
        sourceFailures={sourceFailures}
        defaultSelectedId={defaultSelectedId}
        onNextAction={() => undefined}
        onRetrySources={() => undefined}
      />
    </main>
  );
}

function ControlledLedger({ defaultId }: { defaultId: string | null }) {
  const [selectedId, setSelectedId] = useState<string | null>(defaultId);
  return (
    <main className="mx-auto w-full max-w-2xl p-4 sm:p-8">
      <h1 className="sr-only">Activity ledger proposal</h1>
      <ActivityLedger
        items={mixedItems}
        selectedId={selectedId}
        onSelectedChange={setSelectedId}
        onNextAction={() => undefined}
      />
    </main>
  );
}

const meta = {
  title: "Proposals/Activity ledger",
  id: "proposal-activity-ledger",
  component: ActivityLedger,
  args: { items: [] },
  parameters: {
    layout: "fullscreen",
    viewport: { defaultViewport: "mobile" },
  },
} satisfies Meta<typeof ActivityLedger>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MixedChronology: Story = {
  render: () => <LedgerFrame />,
};

export const PendingByOwnerAndTerminalStates: Story = {
  render: () => <LedgerFrame items={statusItems} />,
};

export const DeduplicatedConfirmation: Story = {
  render: () => <LedgerFrame items={[mixedItems[4]!]} defaultSelectedId={mixedItems[4]!.canonicalId} />,
};

export const PartialSourceFailure: Story = {
  render: () => (
    <LedgerFrame
      items={mixedItems.slice(0, 3)}
      sourceFailures={[{ id: "onchain", label: "Onchain transfers" }]}
    />
  ),
};

export const AllDetailFamilies: Story = {
  render: () => <ControlledLedger defaultId={mixedItems[0]!.canonicalId} />,
};

export const FocusBackAndClose: Story = {
  render: () => <ControlledLedger defaultId={null} />,
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const opener = await screen.findByRole("button", {
      name: /Add money by bank transfer/,
      description: "View Add money by bank transfer details",
    });
    await userEvent.click(opener);
    await expect(await screen.findByRole("dialog")).toBeVisible();
    await userEvent.click(await screen.findByRole("button", { name: "Back" }));
    await waitFor(() => expect(opener).toHaveFocus());
    await userEvent.click(opener);
    await expect(await screen.findByRole("dialog")).toBeVisible();
    await userEvent.click(await screen.findByRole("button", { name: "Close activity details" }));
    await waitFor(() => expect(opener).toHaveFocus());
  },
};

export const HomeNeedsAttention: Story = {
  render: () => (
    <main className="mx-auto w-full max-w-xl p-4 sm:p-8">
      <h1 className="sr-only">Home attention proposal</h1>
      <ActivityNeedsAttention item={mixedItems[0]!} count={2} onNextAction={() => undefined} />
    </main>
  ),
};

export const LongLocalizedContent: Story = {
  render: () => (
    <LedgerFrame items={[{
      ...(mixedItems[0]! as Extract<ActivityLedgerItem, { family: "funding-order" }>),
      title: "Banküberweisung zur Einzahlung in das internationale Hauptkonto fortsetzen",
      exactAmount: "Rp 987.654.321.098,00 IDR",
      occurredAtLabel: "Donnerstag, 19. September 2026 um 11:12",
      statusCopy: {
        label: "Ihre Aufmerksamkeit ist erforderlich",
        description: "Öffnen Sie die Zahlungsanweisungen und schließen Sie die ausstehende Banküberweisung ab.",
      },
      nextAction: { kind: "complete-payment", label: "Zahlungsanweisungen öffnen" },
      detail: {
        family: "funding-order",
        provider: "Internationaler Anbieter für lokale Banküberweisungen",
        paymentMethod: "Mandiri-Banküberweisung mit virtueller Kontonummer",
        orderId: "auftrag-mit-einer-sehr-langen-referenznummer-2048",
      },
    }]} defaultSelectedId={mixedItems[0]!.canonicalId} />
  ),
};

export const TwoHundredPercentText: Story = {
  decorators: [(StoryComponent) => <div style={{ fontSize: "200%" }}><StoryComponent /></div>],
  render: () => <LedgerFrame items={mixedItems.slice(0, 3)} />,
};

export const SmallMobileContainment: Story = {
  parameters: { viewport: { defaultViewport: "smallMobile" } },
  render: () => <LedgerFrame items={mixedItems.slice(0, 3)} />,
};

export const Desktop: Story = {
  parameters: { viewport: { defaultViewport: "desktop" } },
  render: () => <LedgerFrame />,
};

export const ReducedMotionReference: Story = {
  render: () => <ControlledLedger defaultId={mixedItems[2]!.canonicalId} />,
  parameters: {
    docs: {
      description: {
        story: "Stable review target for real-browser prefers-reduced-motion emulation. This story does not force the operating-system media preference.",
      },
    },
  },
};
