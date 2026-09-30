import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { BalancesPage } from "@/client/home/balances-panel";
import {
  FIXTURE_CATALOG,
  FIXTURE_WALLET_TOKEN,
  buildBalancesSnapshotFixture,
  catalogHolding,
  priced,
  pricedCash,
  ready,
  unavailableBalance,
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

export const PartialSubtotals: Story = {
  args: { assetBalances: presentBalances({ status: "ready", snapshot: buildBalancesSnapshotFixture({
    registry: {
      usdc: { balance: ready("1000000"), value: priced("USD", "100"), cashValue: pricedCash("USD", "100") },
      eth: { balance: ready("1000000000000000000"), value: priced("USD", "5000") },
      cbbtc: { balance: unavailableBalance },
    },
  }), error: null }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const investments = within(canvas.getByRole("region", { name: "Investments" }));
    await expect(investments.getByText(/Partial balance/)).toBeVisible();
    await expect(investments.getAllByRole("img", { name: "$50.00" })).toHaveLength(2);
    await expect(canvas.getByText("Partial balance", { exact: true, selector: "p[data-total-status='partial']" })).toBeVisible();
  },
};

export const CatalogUnavailable: Story = {
  args: { assetBalances: presentBalances({ status: "ready", snapshot: buildBalancesSnapshotFixture({
    registry: {
      usdc: { balance: ready("0"), cashValue: pricedCash("USD", "0") },
      eth: { balance: ready("0"), value: priced("USD", "0") },
    },
    coverage: { catalog: "unavailable" },
  }), error: null }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const investments = within(canvas.getByRole("region", { name: "Investments" }));
    const cash = within(canvas.getByRole("region", { name: "Cash" }));
    await expect(canvas.getByText("Balance unavailable")).toBeVisible();
    await expect(investments.getByText("Unavailable")).toBeVisible();
    await expect(investments.queryByText("$0.00")).not.toBeInTheDocument();
    await expect(cash.getAllByRole("img", { name: "$0.00" })).toHaveLength(2);
  },
};

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

const unsupportedSnapshot = buildBalancesSnapshotFixture({ region: "MX", registry: {
  usdc: { balance: ready("5000000"), value: priced("MXN", "2500"), cashValue: pricedCash("USD", "500") },
} });

export const UnsupportedLocalCurrency: Story = {
  args: { assetBalances: presentBalances({ status: "ready", snapshot: unsupportedSnapshot, error: null }) },
  play: async ({ canvasElement }) => {
    const cash = within(within(canvasElement).getByRole("region", { name: "Cash" }));
    const peso = cash.getByText("Mexican peso").closest("li")!;
    await expect(within(peso).getByRole("img", { name: "Verification pending" })).toBeVisible();
    await expect(peso.textContent).not.toMatch(/[0-9]|\$/);
  },
};
