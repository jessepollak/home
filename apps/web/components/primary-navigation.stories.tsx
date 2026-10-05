import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { waitForReady } from "@/tests/helpers/story-readiness";
import { PrimaryNavigation } from "./primary-navigation";

const account = { status: "ready" as const, ownerKey: "owner.base.eth", address: null, disabled: false };

const meta = {
  title: "Navigation/Desktop Rail",
  component: PrimaryNavigation,
  parameters: { layout: "fullscreen", viewport: { defaultViewport: "desktop" } },
  args: { layout: "rail", activeNavigation: "home", account, onNavigate: () => {} },
  decorators: [(Story) => <div className="flex h-svh"><Story /><main id="navigation-panel" className="flex-1 bg-muted" /></div>],
} satisfies Meta<typeof PrimaryNavigation>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Expanded: Story = {
  parameters: { library: { render: "frame" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const rail = canvasElement.querySelector<HTMLElement>("#desktop-rail")!;
    const toggle = canvas.getByRole("button", { name: "Sidebar" });
    if (toggle.getAttribute("aria-expanded") === "false") await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await waitForReady(() => expect(rail.getBoundingClientRect().width).toBe(240));
    for (const name of ["Home", "Invest", "Sidebar", "Account settings"]) {
      const button = name === "Home" ? within(canvas.getByRole("navigation", { name: "Main navigation" })).getByRole("button", { name }) : canvas.getByRole("button", { name });
      await expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      await expect(button.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
    }
    await userEvent.click(toggle);
    await expect(toggle).toHaveFocus();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  },
};

export const Collapsed: Story = {
  parameters: { library: { render: "frame" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole("button", { name: "Sidebar" });
    if (toggle.getAttribute("aria-expanded") === "false") await userEvent.click(toggle);
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await waitForReady(() => expect(canvasElement.querySelector("#desktop-rail")!.getBoundingClientRect().width).toBe(64));
    await expect(within(canvas.getByRole("navigation", { name: "Main navigation" })).getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
    await expect(canvas.getByRole("button", { name: "Account settings" })).toBeVisible();
    await expect(toggle).toHaveFocus();
  },
};

export const RightToLeft: Story = {
  decorators: [(Story) => <div dir="rtl"><Story /></div>],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole("button", { name: "Sidebar" });
    await expect(within(canvas.getByRole("navigation", { name: "Main navigation" })).getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
    if (toggle.getAttribute("aria-expanded") === "false") await userEvent.click(toggle);
    await userEvent.click(toggle);
    await expect(toggle).toHaveFocus();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  },
};
