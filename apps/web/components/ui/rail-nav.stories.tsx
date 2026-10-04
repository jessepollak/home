import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Activity, LayoutDashboard, LifeBuoy } from "lucide-react";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { RailNav, RailNavItem } from "./rail-nav";

function Sections() {
  const [current, setCurrent] = useState("overview");
  return (
    <RailNav aria-label="Operator sections" className="grid w-56 gap-1">
      <RailNavItem href="#overview" label="Overview" icon={LayoutDashboard} current={current === "overview"} onClick={() => setCurrent("overview")} />
      <RailNavItem href="#activity" label="Activity" icon={Activity} current={current === "activity"} onClick={() => setCurrent("activity")} />
      <RailNavItem href="#support" label="Support" icon={LifeBuoy} current={current === "support"} onClick={() => setCurrent("support")} />
    </RailNav>
  );
}

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

export const Unread: Story = { args: { label: "Support", unreadCount: 3, href: "/admin/support" }, play: async ({ canvasElement }) => { const link = within(canvasElement).getByRole("link", { name: "Support, 3 unread" }); await expect(link).toHaveAttribute("href", "/admin/support"); } };

export const Selection: Story = {
  render: () => <Sections />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const overview = canvas.getByRole("link", { name: "Overview" });
    const support = canvas.getByRole("link", { name: "Support" });
    await expect(overview).toHaveAttribute("aria-current", "page");
    await userEvent.click(support);
    await expect(support).toHaveAttribute("aria-current", "page");
    await expect(overview).not.toHaveAttribute("aria-current");
    await userEvent.click(canvas.getByRole("link", { name: "Activity" }));
    await expect(canvas.getByRole("link", { name: "Activity" })).toHaveAttribute("aria-current", "page");
    await expect(support).not.toHaveAttribute("aria-current");
  },
};
