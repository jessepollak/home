import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { HomeOverview } from "@/client/home/home-overview";
import { FundingActions } from "@/client/funding/funding-actions";
import { TransferActions } from "@/client/transfers";
import { ActivityPanelView } from "@/client/activity";
import { presentBalances } from "@/shared/balances/present";
import { balance, wallet } from "../../journeys/explorations/home-pull-to-refresh.fixtures";
import { availableAssets } from "../../journeys/explorations/send-recipient.fixtures";
import { activity, loadingActivity, transfers, pendingSend } from "../../journeys/explorations/activity-transfer-runs.fixtures";
import { CompositionShell, compositionShellHandlers } from "../../journeys/explorations/composition-shell";

type State = "ready" | "loading";

function HomeComposition({ state }: { state: State }) {
  const loading = state === "loading";
  const assetBalances = loading ? presentBalances({ status: "loading", snapshot: null, error: null }) : balance;
  return <CompositionShell assetBalances={assetBalances}>
    <HomeOverview accountKey={wallet.ownerKey} assetBalances={assetBalances} cashRate="4.20% APY" borrowOfferRate="5.10% APR"
      onRetryBalances={() => {}}
      destinations={{ onOpenCash: () => {}, onOpenInvestments: () => {}, onOpenBorrow: () => {} }}
      actions={<><FundingActions regionId="US" /><TransferActions availableAssets={availableAssets} regionId="US" /></>}
      activity={<ActivityPanelView activity={loading ? loadingActivity : activity(transfers)}
        operations={loading ? [] : [pendingSend]} density="feed" regionId="US" />} />
  </CompositionShell>;
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
    msw: { handlers: compositionShellHandlers },
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
