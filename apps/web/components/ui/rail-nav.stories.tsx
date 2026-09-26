import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { LayoutDashboard } from "lucide-react";
import { expect, within } from "storybook/test";
import { RailNavItem } from "./rail-nav";

const meta = {
  id: "ui-rail-nav",
  title: "UI/Rail nav",
  component: RailNavItem,
  args: { href: "/admin", label: "Overview", icon: LayoutDashboard, current: true },
  parameters: { a11y: { test: "error" } },
} satisfies Meta<typeof RailNavItem>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Current: Story = {
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole("link", { name: "Overview" });
    await expect(link).toHaveAttribute("aria-current", "page");
    await expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  },
};

export const RightToLeft: Story = {
  render: (args) => <div dir="rtl"><RailNavItem {...args} /></div>,
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole("link", { name: "Overview" });
    await expect(link).toHaveAttribute("aria-current", "page");
    await expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  },
};
