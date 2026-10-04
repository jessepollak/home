import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ActivityPanelView } from "@/client/activity";
import { activity, transfers, pendingSend, longTransfers } from "./explorations/activity-transfer-runs.fixtures";

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
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Received" }).querySelector('[data-money-step="loading"]')).toBeNull());
    const dialog = screen.getByRole("dialog", { name: "Received" });
    await expect(dialog).toBeVisible();
    await userEvent.click(within(dialog).getByRole("button", { name: "Close Received details" }));
    await waitFor(() => expect(within(recent).getAllByRole("button", { description: "View received USDC transaction details" })[0]).toHaveFocus());
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

export const ActivityPageLatestUnavailable: Story = {
  args: {
    activity: { ...activity(transfers), latestUnavailable: true },
    operations: [pendingSend], regionId: "US", density: "page", header: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Latest activity didn't load. Earlier activity is still shown.")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Retry latest activity" })).toBeVisible();
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
