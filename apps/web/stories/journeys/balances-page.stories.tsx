import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { BalancesPage } from "@/client/home/balances-panel";
import {
  FIXTURE_CATALOG,
  FIXTURE_WALLET_TOKEN,
  buildBalancesSnapshotFixture,
  catalogHolding,
  priced,
  walletHolding,
} from "@/shared/balances/fixtures";
import { presentBalances } from "@/shared/balances/present";

const snapshot = buildBalancesSnapshotFixture({
  catalog: [
    catalogHolding(FIXTURE_CATALOG.priced, "1000000000000000000", priced("USD", "2500")),
    walletHolding(FIXTURE_WALLET_TOKEN, "2000000000000000000", {
      status: "unpriced", reason: "below-market-gate",
    }),
  ],
});

const meta = {
  id: "balances-page",
  title: "Journeys/Balances Page",
  component: BalancesPage,
  args: {
    active: true,
    assetBalances: presentBalances({ status: "ready", snapshot, error: null }),
    showSmallBalances: false,
    revealSmallBalances: false,
    onRevealSmallBalancesChange: () => undefined,
    isChecking: false,
    revealedCount: 10,
    onRevealMore: () => undefined,
  },
  parameters: { a11y: { test: "error" } },
} satisfies Meta<typeof BalancesPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithUnpricedTokens: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const investments = within(canvas.getByRole("region", { name: "Investments" }));
    const unpriced = within(canvas.getByRole("region", { name: "Unpriced" }));
    await expect(investments.getAllByRole("img", { name: "$25.00" })).toHaveLength(2);
    await expect(unpriced.getByText("Discovered Token")).toBeVisible();
    await expect(unpriced.getByRole("img", { name: "2.00 DISC" })).toBeVisible();
    await expect(unpriced.queryByRole("img", { name: "$0.00" })).not.toBeInTheDocument();
  },
};
