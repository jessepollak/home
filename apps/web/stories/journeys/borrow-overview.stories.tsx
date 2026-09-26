import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import borrowOverviewStories from "@/client/borrowing/borrow-overview.stories";
const BorrowStorySurface = borrowOverviewStories.component;
import { VERIFIED_MORPHO_MARKETS } from "@/shared/morpho-markets/config";
import { borrowOverviewBody } from "@/tests/browser/fixtures/bodies";

const meta = {
  id: "journeys-borrow-overview",
  title: "Journeys/Borrow Overview",
  component: BorrowStorySurface,
  parameters: { layout: "fullscreen", viewport: { defaultViewport: "mobile" } },
} satisfies Meta<typeof BorrowStorySurface>;
export default meta;
type Story = StoryObj<typeof meta>;
const screenFor = (canvasElement: HTMLElement) => within(canvasElement.ownerDocument.body);
async function openRepay(canvasElement: HTMLElement) {
  const screen = screenFor(canvasElement);
  const row = screen.getByRole("button", { description: "Manage Bitcoin loan" });
  await userEvent.click(row);
  const management = await screen.findByRole("dialog", { name: "Bitcoin" });
  await expect(within(management).getByText("Borrowed")).toBeVisible();
  await expect(within(management).getByRole("img", { name: /1,250\.00/ })).toBeVisible();
  await userEvent.click(within(management).getByRole("button", { name: "Repay" }));
  const money = await screen.findByRole("dialog", { name: "Repay" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Bitcoin" })).toBeNull());
  return { row, money, screen };
}
async function prepareRepay(canvasElement: HTMLElement) {
  const result = await openRepay(canvasElement);
  await userEvent.type(within(result.money).getByRole("textbox", { name: "Amount" }), "250");
  await userEvent.click(within(result.money).getByRole("button", { name: "Continue" }));
  await expect(await within(result.money).findByRole("button", { name: "Confirm action" })).toBeVisible();
  return result;
}
export const RepayReviewCancelBack: Story = {
  play: async ({ canvasElement }) => {
    const { row, money, screen } = await prepareRepay(canvasElement);
    await userEvent.click(within(money).getAllByRole("button", { name: "Back" })[0]!);
    await expect(within(money).getByRole("button", { name: "Continue" })).toBeVisible();
    await userEvent.click(within(money).getByRole("button", { name: "Close Borrow action" }));
    const management = await screen.findByRole("dialog", { name: "Bitcoin" });
    await waitFor(() => expect(within(management).getByRole("button", { name: "Repay" })).toHaveFocus());
    await userEvent.click(within(management).getByRole("button", { name: "Close Bitcoin details" }));
    await waitFor(() => expect(canvasElement.ownerDocument.activeElement).toBe(row));
  },
};
export const RepaySuccessUpdates: Story = {
  play: async ({ canvasElement }) => {
    const { money, screen } = await prepareRepay(canvasElement);
    await userEvent.click(within(money).getByRole("button", { name: "Confirm action" }));
    await userEvent.click(await within(money).findByRole("button", { name: "Done" }));
    const management = await screen.findByRole("dialog", { name: "Bitcoin" });
    await expect(within(management).getByRole("img", { name: /1,000\.00/ })).toBeVisible();
    await userEvent.click(within(management).getByRole("button", { name: "Close Bitcoin details" }));
    await expect(await screen.findByRole("img", { name: /1,500\.50/ })).toBeVisible();
  },
};
export const RepayAllMaxClearsLoan: Story = {
  play: async ({ canvasElement }) => {
    const screen = screenFor(canvasElement);
    await expect(screen.getByRole("img", { name: "$1,750.50" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { description: "Manage Dogecoin loan" }));
    const management = await screen.findByRole("dialog", { name: "Dogecoin" });
    await expect(within(management).getByRole("img", { name: /80\.00/ })).toBeVisible();
    await userEvent.click(within(management).getByRole("button", { name: "Repay" }));
    const money = within(await screen.findByRole("dialog", { name: "Repay" }));
    await userEvent.click(await money.findByRole("button", { name: "Max" }));
    await userEvent.click(money.getByRole("button", { name: "Continue" }));
    await expect(await money.findByRole("button", { name: "Confirm action" })).toBeVisible();
    await expect(money.getByText("Repay all USDC debt")).toBeVisible();
    await expect(money.getByText("You spend (USDC)").nextElementSibling).toHaveTextContent("Estimated 80 USDC");
    await expect(money.getByText("Maximum repayment (USDC)")).toBeVisible();
    await expect(money.queryByText("You receive (USDC)")).toBeNull();
    await userEvent.click(money.getByRole("button", { name: "Confirm action" }));
    await userEvent.click(await money.findByRole("button", { name: "Done" }));
    const updated = await screen.findByRole("dialog", { name: "Dogecoin" });
    await expect(within(updated).getByText("No debt")).toBeVisible();
    await userEvent.click(within(updated).getByRole("button", { name: "Close Dogecoin details" }));
    await expect(await screen.findByRole("img", { name: "$1,670.50" })).toBeVisible();
  },
};
export const ZeroDebtFullWithdrawReturnsAsset: Story = {
  play: async ({ canvasElement }) => {
    const screen = screenFor(canvasElement);
    const loans = within(screen.getByRole("region", { name: "Open loans" }));
    await userEvent.click(loans.getByRole("button", { description: "Manage XRP loan" }));
    const management = within(await screen.findByRole("dialog", { name: "XRP" }));
    await userEvent.click(management.getByRole("button", { name: "Withdraw collateral from XRP position" }));
    const money = within(await screen.findByRole("dialog", { name: "Withdraw collateral" }));
    await userEvent.click(await money.findByRole("button", { name: "Max" }));
    await userEvent.click(money.getByRole("button", { name: "Continue" }));
    await userEvent.click(await money.findByRole("button", { name: "Confirm action" }));
    await userEvent.click(await money.findByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Withdraw collateral" })).toBeNull());
    await expect(screen.queryByRole("dialog", { name: "XRP" })).toBeNull();
    await expect(loans.queryByRole("button", { description: "Manage XRP loan" })).toBeNull();
    const assets = within(screen.getByRole("region", { name: "Assets you can borrow against" }));
    const held = await assets.findByRole("button", { description: "Borrow against XRP" });
    await expect(held).not.toHaveTextContent("In wallet");
    await expect(held).toHaveTextContent("Available");
  },
};
export const BorrowMaxRespectsMarketLiquidity: Story = {
  play: async ({ canvasElement }) => {
    const screen = screenFor(canvasElement);
    await userEvent.click(screen.getByRole("button", { description: "Manage XRP loan" }));
    const management = within(await screen.findByRole("dialog", { name: "XRP" }));
    await userEvent.click(management.getByRole("button", { name: "Borrow" }));
    const money = within(await screen.findByRole("dialog", { name: "Borrow" }));
    await userEvent.click(await money.findByRole("button", { name: "Max" }));
    await userEvent.click(money.getByRole("button", { name: "Continue" }));
    await expect(await money.findByRole("button", { name: "Confirm action" })).toBeVisible();
    await expect(money.getByText("You receive (USDC)").nextElementSibling).toHaveTextContent(/^500 USDC$/);
    await userEvent.click(money.getByRole("button", { name: "Confirm action" }));
    await userEvent.click(await money.findByRole("button", { name: "Done" }));
    const updated = within(await screen.findByRole("dialog", { name: "XRP" }));
    await expect(updated.getByRole("button", { name: "Borrow more" })).toBeDisabled();
  },
};
export const RepayPending: Story = {
  args: { scenario: "pending" },
  play: async ({ canvasElement }) => {
    const { money, screen } = await prepareRepay(canvasElement);
    await userEvent.click(within(money).getByRole("button", { name: "Confirm action" }));
    await expect(within(money).getByRole("button", { name: "Close Borrow action" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    await expect(screen.getByRole("dialog", { name: "Confirm" })).toBeVisible();
  },
};
export const RepayFailureRecovery: Story = {
  args: { scenario: "failure" },
  play: async ({ canvasElement }) => {
    const { money } = await prepareRepay(canvasElement);
    await userEvent.click(within(money).getByRole("button", { name: "Confirm action" }));
    await expect(await within(money).findByText(/dispatch outcome is unresolved/)).toBeVisible();
    await expect(within(money).getByRole("button", { name: "Retry" })).toBeVisible();
  },
};
export const CollateralBorrowEntryBack: Story = {
  play: async ({ canvasElement }) => {
    const screen = screenFor(canvasElement);
    const row = screen.getByRole("button", { description: "Borrow against Cardano" });
    await userEvent.click(row);
    const management = await screen.findByRole("dialog", { name: "Cardano" });
    await expect(within(management).getByText("Borrow up to")).toBeVisible();
    await userEvent.click(within(management).getByRole("button", { name: "Borrow" }));
    const money = await screen.findByRole("dialog", { name: "Borrow" });
    await userEvent.click(within(money).getByRole("button", { name: "Close Borrow action" }));
    const returned = await screen.findByRole("dialog", { name: "Cardano" });
    await userEvent.click(within(returned).getByRole("button", { name: "Close Cardano details" }));
    await waitFor(() => expect(row).toHaveFocus());
  },
};
export const NotHeldRowsInert: Story = {
  args: { fixture: (() => {
    const overview = borrowOverviewBody({ openMarketId: null });
    return { ...overview, opportunities: overview.opportunities.map((entry) => entry.availability.status === "available"
      ? { ...entry, availability: { ...entry.availability, snapshot: { ...entry.availability.snapshot, wallet: { ...entry.availability.snapshot.wallet, collateralBalanceRaw: "0" } } } }
      : entry) };
  })() },
  play: async ({ canvasElement }) => {
    const assets = within(within(canvasElement).getByRole("region", { name: "Assets you can borrow against" })).getByRole("list");
    for (const name of ["Bitcoin", "XRP", "Staked ETH", "Dogecoin", "Cardano"]) {
      const row = within(assets).getByText(name).closest("li");
      if (!row) throw new Error(`Missing ${name} row`);
      await expect(row).toHaveTextContent(/\d+\.\d+% APR/);
      await expect(row).not.toHaveTextContent("Not in wallet");
      await expect(within(row).queryByRole("button")).toBeNull();
    }
  },
};
export const HeldZeroCapacityInert: Story = {
  args: { fixture: (() => {
    const overview = borrowOverviewBody({ openMarketId: null });
    return { ...overview, opportunities: overview.opportunities.map((entry, index) => entry.availability.status === "available"
      ? { ...entry, availability: { ...entry.availability, snapshot: {
        ...entry.availability.snapshot,
        state: { ...entry.availability.snapshot.state, liquidityAssetsRaw: index === 0 ? "0" : entry.availability.snapshot.state.liquidityAssetsRaw },
        wallet: { ...entry.availability.snapshot.wallet, collateralBalanceRaw: index < 2 ? entry.availability.snapshot.wallet.collateralBalanceRaw : "0" },
      } } }
      : entry) };
  })() },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement);
    const assets = within(screen.getByRole("region", { name: "Assets you can borrow against" }));
    const bitcoin = assets.getByText("Bitcoin").closest("li");
    if (!bitcoin) throw new Error("Missing Bitcoin row");
    await expect(bitcoin).toHaveTextContent("No USDC to borrow now");
    await expect(bitcoin).toHaveTextContent("In wallet");
    await expect(bitcoin).toHaveTextContent(/2.*cbBTC/);
    await expect(within(bitcoin).queryByRole("button")).toBeNull();
    await expect(assets.getByRole("button", { description: "Borrow against XRP" })).toBeVisible();
    await expect(screen.queryByText("Add a supported asset to your wallet to borrow USDC.")).toBeNull();
  },
};
export const UrgentSortedFirst: Story = {
  play: async ({ canvasElement }) => {
    const list = within(within(canvasElement).getByRole("region", { name: "Open loans" })).getByRole("list");
    await expect(within(list).getAllByRole("button")[0]).toHaveTextContent("Dogecoin");
    await expect(within(list).getAllByRole("button")[0]).toHaveAccessibleName(/Urgent Needs attention/);
    await expect(within(list).getAllByRole("button")[0]).toHaveTextContent("Urgent");
  },
};
export const ZeroDebtOpens: Story = { args: { initialMarketId: VERIFIED_MORPHO_MARKETS[1]!.marketId } };
