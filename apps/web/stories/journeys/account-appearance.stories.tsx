import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { HttpResponse, http } from "msw";
import { expect, userEvent, within } from "storybook/test";
import { AccountSettings } from "@/client/account/account-settings";
import type { AppearancePreference } from "@/shared/appearance/preference";

function AccountAppearanceJourney() {
  const [appearancePreference, setAppearancePreference] = useState<AppearancePreference>("light");
  return (
    <main className="mx-auto w-full max-w-160 p-4">
      <AccountSettings
        regionId="US"
        onRegionChange={() => {}}
        resolutionSource="persisted"
        preferenceMessage=""
        isPreferenceReady
        accountAddress="0x1111111111111111111111111111111111111111"
        accountOwnerKey="appearance-story"
        showSmallBalances={false}
        onShowSmallBalancesChange={() => {}}
        appearancePreference={appearancePreference}
        onAppearancePreferenceChange={(next) => {
          setAppearancePreference(next);
          return true;
        }}
        onSignOut={() => {}}
      />
    </main>
  );
}

const meta = {
  id: "journeys-account-appearance",
  title: "Journeys/Account appearance",
  component: AccountAppearanceJourney,
  parameters: {
    viewport: { defaultViewport: "mobile" },
    msw: { handlers: [
      http.get("https://api.ensideas.com/*", () => HttpResponse.json({ name: "appearance.base.eth" })),
    ] },
  },
} satisfies Meta<typeof AccountAppearanceJourney>;

export default meta;
type Story = StoryObj<typeof meta>;

async function selectAppearance(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const group = canvas.getByRole("radiogroup", { name: "Appearance" });
  for (const label of ["Dark", "System", "Light"]) {
    await userEvent.click(within(group).getByRole("radio", { name: label }));
    await expect(within(group).getByRole("radio", { name: label })).toHaveAttribute("aria-checked", "true");
  }
}

export const Light: Story = {
  play: async ({ canvasElement }) => selectAppearance(canvasElement),
};

export const Dark: Story = {
  globals: { theme: "dark" },
  play: async ({ canvasElement }) => selectAppearance(canvasElement),
};
