import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { AccountSettings as ProductAccountSettings } from "@/client/account/account-settings";
import { createBlockedAccountWalletClient } from "@/client/account/cdp-client";
import { ShellHeader } from "@/client/home/shell-chrome";
import { shellContentFrameClassName } from "@/components/shell-layout";
import type { RegionId } from "@/config/regions";
import type { AppearancePreference } from "@/shared/appearance/preference";
import accountJourney from "@/stories/journeys/account-appearance.stories";
import { accountAppearanceAddress, createInviteFetcher, type InviteState } from "@/stories/journeys/explorations/account-appearance-fixture";

const noop = () => {};
function AccountSettingsComposition({ inviteState = "loaded", setup = false }: { inviteState?: InviteState; setup?: boolean }) {
  const [regionId, setRegionId] = useState<RegionId>("US");
  const [appearance, setAppearance] = useState<AppearancePreference>("light");
  const [smallBalances, setSmallBalances] = useState(false);
  const [account] = useState(() => createBlockedAccountWalletClient("unconfigured"));
  return <div className="flex min-h-svh flex-col bg-muted">
    <ShellHeader isAccountSettingsOpen nestedChromeTitle={null} nestedChromeBackLabel="Back" onNestedChromeBack={noop}
      routeMode="dashboard" activeNavigation="home" isVerified={!setup} account={account}
      onHome={noop} onDashboard={noop} onSignIn={noop} onSignOut={noop} onOpenSettings={noop} onCloseSettings={noop} />
    <main className="min-w-0 flex-1">
      <div className={`${shellContentFrameClassName} py-4 sm:py-6`}>
        <ProductAccountSettings regionId={regionId} onRegionChange={setRegionId} resolutionSource="persisted" preferenceMessage="" isPreferenceReady={!setup}
          accountAddress={setup ? null : accountAppearanceAddress} accountOwnerKey={setup ? null : `appearance-story-${inviteState}`}
          fetchAccountResource={createInviteFetcher(inviteState)} showSmallBalances={smallBalances} onShowSmallBalancesChange={setSmallBalances}
          appearancePreference={appearance} onAppearancePreferenceChange={(next) => { setAppearance(next); return true; }} onSignOut={noop} />
      </div>
    </main>
  </div>;
}

const meta = {
  title: "Compositions/Account settings",
  component: AccountSettingsComposition,
  parameters: {
    layout: "fullscreen",
    library: { render: "frame", order: 7 },
    viewport: { viewports: { phone390: { name: "390 × 844", styles: { width: "390px", height: "844px" } } }, defaultViewport: "phone390" },
    msw: accountJourney.parameters.msw,
  },
} satisfies Meta<typeof AccountSettingsComposition>;
export default meta;
type Story = StoryObj<typeof meta>;

export const AccountSettings: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const appearance = within(canvas.getByRole("radiogroup", { name: "Appearance" }));
    for (const label of ["Dark", "System", "Light"]) {
      await userEvent.click(appearance.getByRole("radio", { name: label }));
      await expect(appearance.getByRole("radio", { name: label })).toHaveAttribute("aria-checked", "true");
    }
    const smallBalances = canvas.getByRole("switch", { name: "Show small balances" });
    await userEvent.click(smallBalances);
    await expect(smallBalances).toBeChecked();
    await expect(await canvas.findByRole("button", { name: /Copy invite link/ })).toBeVisible();
  },
};
export const InviteLoading: Story = { args: { inviteState: "loading" } };
export const InviteUnavailable: Story = { args: { inviteState: "unavailable" } };
export const InviteError: Story = {
  args: { inviteState: "error" },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole("button", { name: "Try again" })).toBeVisible();
  },
};
export const SetupInProgress: Story = { args: { setup: true } };
