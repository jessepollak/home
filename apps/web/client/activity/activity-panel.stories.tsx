import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { ActivityPanelView } from "./activity-panel";
import type { UseActivityResult } from "./use-activity";

const retry = fn();

const notConfiguredActivity: UseActivityResult = {
  status: "error",
  page: null,
  loadingMore: false,
  loadMoreError: false,
  continuing: false,
  error: { code: "ACTIVITY_NOT_CONFIGURED", message: "Try again later." },
  retry,
  refresh: () => {},
  setSentinelVisible: () => {},
  retryLoadMore: () => {},
};

const meta = {
  id: "activity-panel-not-configured",
  title: "Activity/Not configured",
  component: ActivityPanelView,
  args: { activity: notConfiguredActivity, density: "page" },
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    viewport: { defaultViewport: "mobile" },
  },
} satisfies Meta<typeof ActivityPanelView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NotConfigured: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const alert = canvas.getByRole("alert");
    await expect(alert.textContent).toContain("Activity is temporarily unavailable.");
    await expect(alert.textContent).toContain("Try again later.");
    await expect(alert.textContent).not.toContain("ACTIVITY_HISTORY_SOURCE");
    await expect(alert.textContent).not.toContain("ACTIVITY_NOT_CONFIGURED");
    retry.mockClear();
    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
    await expect(retry).toHaveBeenCalledTimes(1);
  },
};
