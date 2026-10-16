import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { ResultHeader } from "./result-header";

const meta = {
  id: "ui-result-header",
  title: "UI/ResultHeader",
  component: ResultHeader,
  args: { outcome: "success", title: "$25.00 sent" },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof ResultHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status")).toHaveAttribute("aria-atomic", "true");
    await expect(canvas.getByRole("heading", { name: "$25.00 sent" })).toBeVisible();
  },
};
export const Pending: Story = { args: { outcome: "pending", title: "$25.00 on its way", description: "We'll update Activity when it's confirmed." } };
export const Failed: Story = { args: { outcome: "failed", title: "$25.00 wasn't sent", description: "Your $25.00 is still in your account." } };
export const Unknown: Story = { args: { outcome: "unknown", title: "We can't confirm $25.00", description: "It may have gone through. Check Activity before trying again." } };

export const Dark: Story = { ...Pending, globals: { theme: "dark" } };
export const PendingPage: Story = {
  args: { outcome: "pending", title: "Deletion queued", description: "Waiting for pending money items to settle.", headingLevel: 2, textTone: "foreground" },
  render: (args) => <main className="space-y-6 bg-muted p-6"><h1 className="text-base font-semibold">Leave Home</h1><ResultHeader {...args} /></main>,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("heading", { name: "Deletion queued", level: 2 })).toBeVisible();
  },
};
