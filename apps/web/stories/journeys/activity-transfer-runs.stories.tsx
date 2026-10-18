import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState, type ComponentProps } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { waitForReady } from "@/tests/helpers/story-readiness";
import { ActivityPanelView } from "@/client/activity";
import { activity, transfers, pendingSend, longTransfers, errorActivity } from "./explorations/activity-transfer-runs.fixtures";

const transfersUnavailable = {
  ...activity(transfers),
  page: { ...activity(transfers).page, onchainStatus: "unavailable" as const },
};

const meta = {
  id: "journeys-activity-transfer-runs",
  title: "Journeys/Activity transfer runs",
  component: ActivityPanelView,
  decorators: [(Story) => <main className="mx-auto w-full max-w-2xl p-4"><Story /></main>],
  parameters: { layout: "fullscreen", viewport: { defaultViewport: "mobile" } },
} satisfies Meta<typeof ActivityPanelView>;
export default meta;
type Story = StoryObj<typeof meta>;

async function expectConciseNotices(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await expect(canvas.queryByText(/onchain/i)).toBeNull();
  await expect(canvas.queryByText(/Recorded Home actions/)).toBeNull();
  for (const notice of canvas.getAllByRole("status")) {
    await expect(notice).not.toHaveTextContent(/\.\s*$/);
  }
}

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
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText("Some activity is unavailable")).toBeNull();
    await expect(canvas.queryByRole("button", { name: "Try again" })).toBeNull();
  },
};

export const ActivityPageTransfersUnavailable: Story = {
  args: { activity: transfersUnavailable, operations: [pendingSend], regionId: "US", density: "page", header: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Some activity is unavailable")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(canvas.getByRole("list", { name: "Pending" })).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Retry onchain transfers" })).toBeNull();
  },
};

export const ActivityPageActionsUnavailable: Story = {
  args: {
    activity: activity(transfers), operations: [pendingSend], regionId: "US", density: "page", header: null,
    actionsStatus: "error", retryActions: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Your Home actions are unavailable")).toBeVisible();
    await expect(canvas.queryByText("End of activity")).toBeNull();
    const retry = canvas.getByRole("button", { name: "Retry Home actions" });
    await expect(retry).toBeVisible();
    await expect(retry).toHaveAccessibleDescription("Your Home actions are unavailable");
    await userEvent.click(retry);
    await expect(args.retryActions).toHaveBeenCalledTimes(1);
    await expectConciseNotices(canvasElement);
  },
};

function RecoveringSources(args: ComponentProps<typeof ActivityPanelView>) {
  const [actionsStatus, setActionsStatus] = useState<"ready" | "error">("error");
  const [ordersStatus, setOrdersStatus] = useState<"ready" | "error">("error");
  return (
    <ActivityPanelView
      {...args}
      actionsStatus={actionsStatus}
      retryActions={() => setActionsStatus("ready")}
      ordersStatus={ordersStatus}
      retryOrders={() => setOrdersStatus("ready")}
    />
  );
}

export const ActivityPageEndMarkerFollowsSources: Story = {
  args: { activity: activity(transfers), operations: [pendingSend], regionId: "US", density: "page", header: null },
  render: (args) => <RecoveringSources {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Your Home actions are unavailable")).toBeVisible();
    await expect(canvas.getByText("Add money and cash-out orders are unavailable")).toBeVisible();
    await expect(canvas.queryByText("End of activity")).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Retry Home actions" }));
    await expect(canvas.queryByText("Your Home actions are unavailable")).toBeNull();
    await expect(canvas.queryByText("End of activity")).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Retry orders" }));
    await expect(canvas.queryByText("Add money and cash-out orders are unavailable")).toBeNull();
    await expect(canvas.getByText("End of activity")).toBeVisible();
  },
};

export const ActivityPageTransfersAndActionsUnavailable: Story = {
  args: {
    activity: { ...transfersUnavailable, retry: fn() },
    operations: [pendingSend], regionId: "US", density: "page", header: null,
    actionsStatus: "error", retryActions: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Some activity is unavailable")).toBeVisible();
    await expect(canvas.getByText("Your Home actions are unavailable")).toBeVisible();
    const retryTransfers = canvas.getByRole("button", { name: "Try again" });
    const retryActions = canvas.getByRole("button", { name: "Retry Home actions" });
    await expect(retryTransfers).toBeVisible();
    await expect(retryActions).toBeVisible();
    await expect(retryTransfers).toHaveAccessibleDescription("Some activity is unavailable");
    await expect(retryActions).toHaveAccessibleDescription("Your Home actions are unavailable");
    await userEvent.click(retryTransfers);
    await expect(args.activity.retry).toHaveBeenCalledTimes(1);
    await expect(args.retryActions).not.toHaveBeenCalled();
    await userEvent.click(retryActions);
    await expect(args.retryActions).toHaveBeenCalledTimes(1);
    await expect(args.activity.retry).toHaveBeenCalledTimes(1);
    await expectConciseNotices(canvasElement);
  },
};

export const ActivityPageAllSourcesUnavailable: Story = {
  args: {
    activity: {
      ...transfersUnavailable,
      page: { ...transfersUnavailable.page, cards: { version: 1, status: "unavailable", rows: [] } },
      retry: fn(),
    },
    operations: [pendingSend], regionId: "US", density: "page", header: null,
    actionsStatus: "error", retryActions: fn(), ordersStatus: "error", retryOrders: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Some activity is unavailable")).toBeVisible();
    await expect(canvas.getByText("Your Home actions are unavailable")).toBeVisible();
    await expect(canvas.getByText("Add money and cash-out orders are unavailable")).toBeVisible();
    await expect(canvas.getByText("Card purchases may be out of date")).toBeVisible();
    const retryTransfers = canvas.getByRole("button", { name: "Try again" });
    const retryActions = canvas.getByRole("button", { name: "Retry Home actions" });
    const retryOrders = canvas.getByRole("button", { name: "Retry orders" });
    await expect(retryTransfers).toBeVisible();
    await expect(retryActions).toBeVisible();
    await expect(retryOrders).toBeVisible();
    await expect(retryOrders).toHaveAccessibleDescription("Add money and cash-out orders are unavailable");
    await userEvent.click(retryOrders);
    await expect(args.retryOrders).toHaveBeenCalledTimes(1);
    await expect(args.activity.retry).not.toHaveBeenCalled();
    await expect(args.retryActions).not.toHaveBeenCalled();
    await expectConciseNotices(canvasElement);
  },
};

export const ActivityPageOrdersUnavailable: Story = {
  args: {
    activity: activity(transfers), operations: [pendingSend], regionId: "US", density: "page", header: null,
    ordersStatus: "error", retryOrders: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Add money and cash-out orders are unavailable")).toBeVisible();
    const retry = canvas.getByRole("button", { name: "Retry orders" });
    await expect(retry).toBeVisible();
    await expect(retry).toHaveAccessibleDescription("Add money and cash-out orders are unavailable");
    await userEvent.click(retry);
    await expect(args.retryOrders).toHaveBeenCalledTimes(1);
    await expectConciseNotices(canvasElement);
  },
};

export const ActivityPageTransfersError: Story = {
  args: { activity: errorActivity, operations: [pendingSend], regionId: "US", density: "page", header: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Some activity is unavailable")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Try again" })).toBeVisible();
    const pending = canvas.getByRole("list", { name: "Pending" });
    await expect(within(pending).getByRole("button", { description: "View Sent USDC transaction details" })).toBeVisible();
    await expect(canvas.queryByText("Activity is temporarily unavailable.")).toBeNull();
  },
};

export const ActivityPageTransfersRetry: Story = {
  args: {
    activity: { ...transfersUnavailable, retry: fn() },
    operations: [pendingSend], regionId: "US", density: "page", header: null,
  },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Try again" }));
    await expect(args.activity.retry).toHaveBeenCalledTimes(1);
  },
};

export const ActivityPageLatestUnavailable: Story = {
  args: {
    activity: { ...activity(transfers), latestUnavailable: true },
    operations: [pendingSend], regionId: "US", density: "page", header: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Latest activity didn't load")).toBeVisible();
    const retry = canvas.getByRole("button", { name: "Retry latest activity" });
    await expect(retry).toBeVisible();
    await expect(retry).toHaveAccessibleDescription("Latest activity didn't load");
    await expectConciseNotices(canvasElement);
    const recent = canvas.getByRole("list", { name: "Recent" });
    await expect(recent).toBeVisible();
    await expect(within(recent).getByRole("button", { description: "4 Received USDC transfers" })).toBeVisible();
  },
};

export const HomeFeedLatestUnavailable: Story = {
  args: {
    activity: { ...activity(transfers), latestUnavailable: true },
    operations: [pendingSend], regionId: "US", density: "feed",
    header: <h2 id="activity-title" className="text-lg font-semibold">Activity</h2>,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Some activity is unavailable")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Reload activity" })).toBeVisible();
    const recent = canvas.getByRole("list", { name: "Recent" });
    await expect(recent).toBeVisible();
    await expect(within(recent).getByRole("button", { description: "4 Received USDC transfers" })).toBeVisible();
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
