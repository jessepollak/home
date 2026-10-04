import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ActivityPanelView } from "@/client/activity";
import type { UseActivityResult } from "@/client/activity/use-activity";
import { shellContentFrameClassName } from "@/components/shell-layout";
import { activity, transfers, pendingSend } from "../../journeys/explorations/activity-transfer-runs.fixtures";

type State = "ready" | "loading" | "error" | "empty" | "partial";

function ActivityComposition({ state }: { state: State }) {
  const ready = activity(state === "empty" ? [] : transfers);
  const current: UseActivityResult = state === "loading" ? { ...ready, status: "loading", page: null, loadingMore: false, loadMoreError: false, continuing: false }
    : state === "error" ? { ...ready, status: "error", page: null, loadingMore: false, loadMoreError: false, continuing: false, error: { code: "unavailable", message: "Activity unavailable" } }
    : state === "partial" ? { ...ready, latestUnavailable: true } : ready;
  return <main className={`${shellContentFrameClassName} py-4`}>
    <ActivityPanelView activity={current} operations={state === "ready" || state === "partial" ? [pendingSend] : []}
      regionId="US" density="page" header={null} />
  </main>;
}

const meta = {
  title: "Compositions/Activity",
  component: ActivityComposition,
  args: { state: "ready" },
  parameters: {
    layout: "fullscreen",
    library: { render: "frame", order: 4 },
    viewport: { viewports: { desktop1280: { name: "1280 × 800", styles: { width: "1280px", height: "800px" } } }, defaultViewport: "desktop1280" },
    a11y: { test: "error" },
  },
} satisfies Meta<typeof ActivityComposition>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Activity: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("list", { name: "Pending" })).toBeVisible();
    await expect(within(canvasElement).getByRole("list", { name: "Recent" })).toBeVisible();
  },
};
export const ActivityDetail: Story = {
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await userEvent.click(screen.getByRole("button", { description: "View Sent USDC transaction details" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Sent USDC" })).toBeVisible());
  },
};
export const ActivityLoading: Story = { args: { state: "loading" } };
export const ActivityError: Story = { args: { state: "error" } };
export const ActivityEmpty: Story = {
  args: { state: "empty" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("No activity yet")).toBeVisible();
  },
};
export const ActivityPartial: Story = {
  args: { state: "partial" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("button", { name: "Retry latest activity" })).toBeVisible();
  },
};
