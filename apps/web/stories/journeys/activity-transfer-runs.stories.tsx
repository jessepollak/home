import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState, type ComponentProps } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { waitForReady } from "@/tests/helpers/story-readiness";
import { ActivityPanelView } from "@/client/activity";
import { Button } from "@/components/ui/button";
import type { ActivityOrder } from "@/shared/activity/contract-orders";
import { activity, transfers, pendingSend, longTransfers, errorActivity } from "./explorations/activity-transfer-runs.fixtures";

const meta = {
  id: "journeys-activity-transfer-runs",
  title: "Journeys/Activity transfer runs",
  component: ActivityPanelView,
  decorators: [(Story) => <main className="mx-auto w-full max-w-2xl p-4"><Story /></main>],
  parameters: { layout: "fullscreen", viewport: { defaultViewport: "mobile" } },
} satisfies Meta<typeof ActivityPanelView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const HomeFeedMobile: Story = {
  args: {
    activity: activity(transfers), operations: [pendingSend], regionId: "US", density: "feed",
    header: <h2 id="activity-title" className="text-lg font-semibold">Activity</h2>,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const screen = within(canvasElement.ownerDocument.body);
    const pending = canvas.getByRole("list", { name: "Pending" });
    const recent = canvas.getByRole("list", { name: "Recent" });
    await expect(within(pending).getByRole("button", { description: "View Sent USDC transaction details" })).toBeVisible();
    await expect(within(pending).getAllByRole("button")).toHaveLength(1);
    await expect(within(pending).queryByRole("button", { description: /transfers$/ })).toBeNull();

    const summary = within(recent).getByRole("button", { description: "4 Received USDC transfers" });
    await expect(summary).toHaveTextContent("Received ×4");
    await expect(within(summary).getByRole("img", { name: "+$1,000.00" })).toBeVisible();
    await expect(summary).toHaveTextContent("Sep 21 – 24");
    await expect(within(recent).getByRole("button", { description: "2 Received USDC transfers" })).toBeVisible();
    const bitcoinRun = within(recent).getByRole("button", { description: "3 Received cbBTC transfers" });
    await expect(bitcoinRun).toHaveTextContent("+0.006 cbBTC");
    await expect(bitcoinRun).not.toHaveTextContent("$");

    summary.focus();
    await userEvent.keyboard("{Enter}");
    await expect(summary).toHaveAttribute("aria-expanded", "true");
    const controlledId = summary.getAttribute("aria-controls")!;
    await expect(controlledId).toBe(recent.id);
    await expect(canvasElement.ownerDocument.getElementById(controlledId)).toBe(recent);
    const children = within(recent).getAllByRole("button", { description: "View received USDC transaction details" });
    await expect(children).toHaveLength(4);
    await userEvent.click(children[0]!);
    await waitForReady(() => expect(screen.getByRole("dialog", { name: "Received" }).querySelector('[data-money-step="loading"]')).toBeNull());
    const dialog = screen.getByRole("dialog", { name: "Received" });
    await expect(dialog).toBeVisible();
    await userEvent.click(within(dialog).getByRole("button", { name: "Close Received details" }));
    await waitForReady(() => expect(within(recent).getAllByRole("button", { description: "View received USDC transaction details" })[0]).toHaveFocus());
    summary.focus();
    await userEvent.keyboard(" ");
    await expect(summary).toHaveAttribute("aria-expanded", "false");
    await expect(summary).not.toHaveAttribute("aria-controls");
    await expect(canvasElement.ownerDocument.getElementById(controlledId)).toBe(recent);
    await expect(within(recent).queryByRole("button", { description: "View received USDC transaction details" })).toBeNull();
  },
};

export const ActivityPageDesktop: Story = {
  args: { activity: activity(transfers), operations: [pendingSend], regionId: "US", density: "page", header: null },
  parameters: { viewport: { defaultViewport: "desktop" } },
};

export const ActivityPageMobile: Story = {
  args: { activity: activity(transfers), operations: [pendingSend], regionId: "US", density: "page", header: null },
};

const pendingOrder: ActivityOrder = {
  kind: "funding", id: "fixture-pending-funding", region: "US", providerId: "coinbase", providerName: "Coinbase",
  paymentMethodLabel: "Debit card", status: "waiting-customer", stage: "awaiting-payment", instruction: null, resumable: true,
  fiatAmount: "50", fiatCurrency: "USD", asset: { id: "usdc", symbol: "USDC", decimals: 6 }, tokenAmountAtomic: "50000000",
  sandbox: false, expiresAt: null, clearableAt: null, transactionHash: null, logIndex: null,
  createdAt: "2026-09-26T11:00:00.000Z", updatedAt: "2026-09-26T11:00:00.000Z",
};

function FailingSources(args: ComponentProps<typeof ActivityPanelView>) {
  const [failed, setFailed] = useState(false);
  return <>
    <Button onClick={() => setFailed(true)}>Fail source reads</Button>
    <ActivityPanelView {...args}
      activity={failed && args.activity.status === "ready" ? { ...args.activity, failed: true, latestUnavailable: true } : args.activity}
      operations={failed ? [] : [pendingSend]} orders={failed ? [] : [pendingOrder]}
      actionsStatus={failed ? "error" : "ready"} ordersStatus={failed ? "error" : "ready"} />
  </>;
}

export const ActivityPageRetainsRowsOnSourceFailure: Story = {
  args: { activity: activity(transfers), regionId: "US", density: "page", header: null },
  render: (args) => <FailingSources {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const send = canvas.getByRole("button", { description: "View Sent USDC transaction details" });
    const order = canvas.getByRole("button", { name: /Add money.*50/ });
    const received = canvas.getByRole("button", { description: "4 Received USDC transfers" });
    await expect(send).toBeVisible();
    await expect(order).toBeVisible();
    await expect(received).toBeVisible();
    const rows = canvas.getAllByRole("listitem");
    await userEvent.click(canvas.getByRole("button", { name: "Fail source reads" }));
    await expect(send).toBeVisible();
    await expect(order).toBeVisible();
    await expect(received).toBeVisible();
    await expect(canvas.getAllByRole("listitem")).toHaveLength(rows.length);
    await expect(canvas.queryByText(/Some activity is unavailable|Latest activity didn't load|Your Home actions are unavailable|Add money and cash-out orders are unavailable/)).toBeNull();
    await expect(canvas.queryByRole("button", { name: /Try again|Retry|Reload activity/ })).toBeNull();
    await expect(canvas.queryByRole("alert")).toBeNull();
  },
};

export const HomeFeedKeepsRowsOnPartialRead: Story = {
  args: {
    activity: {
      ...activity(transfers), latestUnavailable: true,
      page: { ...activity(transfers).page, onchainStatus: "unavailable", cards: { version: 1, status: "unavailable", rows: [] } },
    },
    operations: [pendingSend], actionsStatus: "error", ordersStatus: "error", regionId: "US", density: "feed",
    header: <h2 id="activity-title" className="text-lg font-semibold">Activity</h2>,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { description: "4 Received USDC transfers" })).toBeVisible();
    await expect(canvas.getByRole("button", { description: "View Sent USDC transaction details" })).toBeVisible();
    await expect(canvas.queryByText(/Some activity is unavailable|Latest activity didn't load|Your Home actions are unavailable|Add money and cash-out orders are unavailable|Card purchases may be out of date/)).toBeNull();
    await expect(canvas.queryByRole("button", { name: /Try again|Retry|Reload activity/ })).toBeNull();
    await expect(canvas.queryByRole("alert")).toBeNull();
  },
};

export const ActivityPageFirstLoadFailure: Story = {
  args: { activity: { ...errorActivity, retry: fn() }, operations: [], regionId: "US", density: "page", header: null },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("alert")).toHaveTextContent("Activity is temporarily unavailable.");
    await expect(canvas.queryByRole("list")).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
    await expect(args.activity.retry).toHaveBeenCalledTimes(1);
  },
};

export const LongRunScroll: Story = {
  args: { activity: activity(longTransfers), operations: [pendingSend], regionId: "US", density: "page", header: null },
  play: async ({ canvasElement }) => {
    const recent = within(canvasElement).getByRole("list", { name: "Recent" });
    await expect(within(recent).getByRole("button", { description: "60 Received USDC transfers" }))
      .toHaveTextContent("Received ×60");
  },
};
