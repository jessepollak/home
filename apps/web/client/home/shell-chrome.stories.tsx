import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ComponentProps } from "react";
import { expect } from "storybook/test";
import { ShellHeader } from "./shell-chrome";

const account = {
  status: "unavailable",
  isSignedIn: false,
  ownerKey: null,
  session: null,
} as unknown as ComponentProps<typeof ShellHeader>["account"];

const noop = () => {};

const meta = {
  id: "home-shell-header",
  title: "Home/Shell Header",
  component: ShellHeader,
  parameters: { layout: "fullscreen" },
  args: {
    isAccountSettingsOpen: false,
    nestedChromeTitle: null,
    nestedChromeBackLabel: "Back",
    onNestedChromeBack: noop,
    routeMode: "dashboard",
    activeNavigation: "home",
    isVerified: true,
    account,
    onHome: noop,
    onDashboard: noop,
    onSignIn: noop,
    onSignOut: noop,
    onOpenSettings: noop,
    onCloseSettings: noop,
  },
  play: async ({ canvasElement }) => {
    const mark = canvasElement.querySelector<HTMLElement>("[data-home-mark]");
    const title = canvasElement.querySelector<HTMLElement>("[data-shell-header-title]");
    if (!mark || !title) throw new Error("Shell header geometry is unavailable.");
    const markRect = mark.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    const gap = Number.parseFloat(getComputedStyle(title.parentElement ?? title).columnGap);
    await expect(markRect.width).toBeLessThanOrEqual(45);
    await expect(Math.abs(titleRect.left - markRect.right - gap)).toBeLessThanOrEqual(1);
    await expect(titleRect.left - markRect.left).toBeLessThanOrEqual(44 + gap + 1);
  },
} satisfies Meta<typeof ShellHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {};

export const Mobile390: Story = {
  parameters: {
    viewport: { defaultViewport: "mobile" },
  },
};
