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

const railViewport = { viewport: { viewports: { rail1440: { name: "1440 × 900", styles: { width: "1440px", height: "900px" } } }, defaultViewport: "rail1440" } };

function statusAccount(status: string, isSignedIn: boolean) {
  return { status, isSignedIn, ownerKey: null, session: null } as unknown as ComponentProps<typeof ShellHeader>["account"];
}

export const RailReplacesProfile: Story = {
  args: { hasDesktopRail: true, account: statusAccount("verified", true) },
  parameters: railViewport,
  play: async ({ canvasElement }) => {
    const banner = within(canvasElement).getByRole("banner");
    await expect(within(banner).queryByRole("button", { name: "Account" })).toBeNull();
    await expect(within(banner).queryByRole("button", { name: "Home" })).toBeNull();
  },
};

export const RailReplacesSignInWhileSigningOut: Story = {
  args: { hasDesktopRail: true, isVerified: false, account: statusAccount("signing-out", false) },
  parameters: railViewport,
  play: async ({ canvasElement }) => {
    const banner = within(canvasElement).getByRole("banner");
    await expect(within(banner).queryByRole("button", { name: "Sign in" })).toBeNull();
  },
};

export const RailKeepsSignOutRecovery: Story = {
  args: { hasDesktopRail: true, isVerified: false, account: statusAccount("signout-error", false) },
  parameters: railViewport,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("button", { name: "Retry sign out" })).toBeVisible();
  },
};

export const SignedOutWithoutRail: Story = {
  args: { hasDesktopRail: false, isVerified: false, account: statusAccount("signed-out", false) },
  parameters: railViewport,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(within(canvasElement).getByRole("button", { name: "Home" })).toBeVisible();
  },
};
