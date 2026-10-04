import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { AccountWalletContext } from "@/client/account/cdp-client";
import { DashboardShell } from "@/client/home/shell";
import { HomeOverview } from "@/client/home/home-overview";
import { FundingActions } from "@/client/funding/funding-actions";
import { TransferActions } from "@/client/transfers";
import { ActivityPanelView } from "@/client/activity";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { presentBalances } from "@/shared/balances/present";
import { balance, wallet, homeShellHandlers } from "../../journeys/explorations/home-pull-to-refresh.fixtures";
import { availableAssets, sendRecipientHandlers } from "../../journeys/explorations/send-recipient.fixtures";
import { activity, transfers, pendingSend } from "../../journeys/explorations/activity-transfer-runs.fixtures";

type State = "ready" | "loading";

function HomeComposition({ state }: { state: State }) {
  const assetBalances = state === "loading" ? presentBalances({ status: "loading", snapshot: null, error: null })
    : balance;
  return <AccountWalletContext.Provider value={wallet}>
    <PresentationRegionProvider regionId="US">
      <DashboardShell assetBalances={assetBalances} sendAvailability={availableAssets} region={{
        regionId: "US", resolutionSource: "persisted", isPreferenceReady: true, preferenceMessage: "",
        selectRegion: () => {}, offeredCountries: ["US"],
      }}>
        <HomeOverview accountKey={wallet.ownerKey} assetBalances={assetBalances} cashRate="4.20% APY" borrowOfferRate="5.10% APR"
          onRetryBalances={() => {}}
          destinations={{ onOpenCash: () => {}, onOpenInvestments: () => {}, onOpenBorrow: () => {} }}
          actions={<><FundingActions regionId="US" /><TransferActions availableAssets={availableAssets} regionId="US" /></>}
          activity={<ActivityPanelView activity={activity(transfers)}
            operations={[pendingSend]} density="feed" regionId="US" />} />
      </DashboardShell>
    </PresentationRegionProvider>
  </AccountWalletContext.Provider>;
}

const meta = {
  id: "compositions-home",
  title: "Compositions/Home",
  component: HomeComposition,
  args: { state: "ready" },
  parameters: {
    layout: "fullscreen",
    library: { render: "frame", order: 1 },
    viewport: { viewports: { phone390: { name: "390 × 844", styles: { width: "390px", height: "844px" } } }, defaultViewport: "phone390" },
    a11y: { test: "error" },
    nextjs: { navigation: { pathname: "/home" } },
    msw: { handlers: [...homeShellHandlers, ...sendRecipientHandlers] },
  },
} satisfies Meta<typeof HomeComposition>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Home: Story = {
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByLabelText("Total balance")).toBeVisible();
    await expect(within(canvasElement).getByRole("button", { name: "Send" })).toBeVisible();
  },
};
export const HomeLoading: Story = { args: { state: "loading" } };
