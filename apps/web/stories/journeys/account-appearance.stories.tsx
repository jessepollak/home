import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useCallback, useRef, useState } from "react";
import { HttpResponse, http } from "msw";
import { expect, userEvent, within } from "storybook/test";
import { SupportProvider, useOptionalSupport } from "@/client/support/support-provider";
import { ProfileMark } from "@/components/profile-mark";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { Button } from "@/components/ui/button";
import { AccountSettings } from "@/client/account/account-settings";
import type { AppearancePreference } from "@/shared/appearance/preference";
import { accountAppearanceAddress, createInviteFetcher, type InviteState } from "./explorations/account-appearance-fixture";

function AccountAppearanceJourney({ inviteState = "loaded" }: { inviteState?: InviteState }) {
  const [appearancePreference, setAppearancePreference] = useState<AppearancePreference>("light");
  return (
    <main className="mx-auto w-full max-w-160 p-4">
      <AccountSettings
        regionId="US"
        onRegionChange={() => {}}
        resolutionSource="persisted"
        preferenceMessage=""
        isPreferenceReady
        accountAddress={accountAppearanceAddress}
        accountOwnerKey={`appearance-story-${inviteState}`}
        fetchAccountResource={createInviteFetcher(inviteState)}
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
    a11y: { test: "error" },
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

export const InviteLoading: Story = {
  args: { inviteState: "loading" },
};

export const InviteUnavailable: Story = {
  args: { inviteState: "unavailable" },
};

export const InviteError: Story = {
  args: { inviteState: "error" },
};

type SummaryScenario = "pending" | "error" | "zero" | "positive" | "stale-positive" | "stale-zero" | "signed-out";
function SummaryControls() {
  const support = useOptionalSupport();
  return <><div id="navigation-panel"><ProfileMark status="ready" ownerKey="summary-story" supportUnreadCount={support?.unreadCount} supportSummaryStatus={support?.summaryStatus} /><PrimaryNavigation layout="rail" activeNavigation="home" onNavigate={() => {}} account={{ status: "ready", ownerKey: "summary-story", address: null, disabled: false }} />{support ? <Button onClick={support.retrySummary}>Refresh summary</Button> : null}<AccountAppearanceJourney /></div></>;
}
function SummaryJourney({ scenario }: { scenario: SummaryScenario }) {
  const attempts = useRef(0);
  const fetchAccountResource = useCallback(async () => {
    ++attempts.current;
    if (scenario === "pending") return new Promise<unknown>(() => {});
    if (scenario === "error" && attempts.current === 1 || scenario.startsWith("stale") && attempts.current > 1) throw new Error("Summary unavailable");
    return { version: 2, unreadCount: scenario === "positive" || scenario === "stale-positive" ? 3 : 0 };
  }, [scenario]);
  return <SupportProvider ownerKey={scenario === "signed-out" ? null : `support-summary-story-${scenario}`} fetchAccountResource={fetchAccountResource} fetchAccountResponse={async () => new Response(null, { status: 204 })}><SummaryControls /></SupportProvider>;
}
const summaryStory = { parameters: { viewport: { defaultViewport: "desktop" } } };
export const SupportChecking: Story = { ...summaryStory, render: () => <SummaryJourney scenario="pending" />, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(await canvas.findByText("Checking messages")).toBeVisible();
  await expect(canvas.getByRole("button", { name: "Account, checking support messages" })).toBeVisible();
  await expect(canvas.getByRole("button", { name: "Account settings, checking support messages" })).toBeVisible();
  await expect(canvas.queryByText(/unread/)).toBeNull();
} };
export const SupportUnavailableRetry: Story = { ...summaryStory, render: () => <SummaryJourney scenario="error" />, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(await canvas.findByText("Couldn't check messages")).toBeVisible();
  await expect(canvas.getByRole("button", { name: "Account, couldn't check support messages" })).toBeVisible();
  await expect(canvas.getByRole("button", { name: "Account settings, couldn't check support messages" })).toBeVisible();
  await userEvent.click(canvas.getByRole("button", { name: "Retry checking support messages" }));
  await expect(await canvas.findByRole("button", { name: "Account" })).toBeVisible();
  await expect(canvas.queryByText("Couldn't check messages")).toBeNull();
} };
export const SupportZero: Story = { ...summaryStory, render: () => <SummaryJourney scenario="zero" />, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(await canvas.findByText("Message us")).toBeVisible();
  await expect(canvas.getByRole("button", { name: "Account" })).toBeVisible();
  await expect(canvas.getByRole("button", { name: "Account settings" })).toBeVisible();
  await expect(canvas.queryByText(/unread/)).toBeNull();
} };
export const SupportPositive: Story = { ...summaryStory, render: () => <SummaryJourney scenario="positive" />, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(await canvas.findByText("3 unread")).toBeVisible();
  await expect(canvas.getByRole("button", { name: "Account, 3 unread support messages" })).toBeVisible();
  await expect(canvas.getByRole("button", { name: "Account settings, 3 unread support messages" })).toBeVisible();
} };
export const SupportStalePositive: Story = { ...summaryStory, render: () => <SummaryJourney scenario="stale-positive" />, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await canvas.findByText("3 unread");
  await userEvent.click(canvas.getByRole("button", { name: "Refresh summary" }));
  await expect(await canvas.findByText("3 unread · may be out of date")).toBeVisible();
  await expect(canvas.getByRole("button", { name: "Account, 3 unread support messages, couldn't check support messages, unread count may be out of date" })).toBeVisible();
  await expect(canvas.getByRole("button", { name: "Account settings, 3 unread support messages, couldn't check support messages, unread count may be out of date" })).toBeVisible();
  await expect(canvas.getByRole("button", { name: "Retry checking support messages" })).toBeVisible();
} };
export const SupportStaleZero: Story = { ...summaryStory, render: () => <SummaryJourney scenario="stale-zero" />, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await canvas.findByText("Message us");
  await userEvent.click(canvas.getByRole("button", { name: "Refresh summary" }));
  await expect(await canvas.findByText("Couldn't check messages")).toBeVisible();
  await expect(canvas.getByRole("button", { name: "Account, couldn't check support messages" })).toBeVisible();
  await expect(canvas.queryByText(/unread/)).toBeNull();
} };
export const SupportSignedOut: Story = { ...summaryStory, render: () => <SummaryJourney scenario="signed-out" />, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(await canvas.findByRole("button", { name: "Account" })).toBeVisible();
  await expect(canvas.getByRole("button", { name: "Account settings" })).toBeVisible();
  await expect(canvas.queryByRole("heading", { name: "Support" })).toBeNull();
  await expect(canvas.queryByText("Checking messages")).toBeNull();
} };
