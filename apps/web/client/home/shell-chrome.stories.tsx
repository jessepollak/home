import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ComponentProps } from "react";
import { expect, within } from "storybook/test";
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
    await expect(within(canvasElement).getByRole("heading", { name: "Home" })).toBeVisible();
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
