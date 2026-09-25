import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { ActivityPanelView } from "@/client/activity";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { UseActivityResult } from "@/client/activity/use-activity";

const time = "2026-09-15T12:00:00.000Z";
const noop = () => {};
const activity: UseActivityResult = {
  status: "ready", page: { walletAddress: "0x1111111111111111111111111111111111111111", chainId: 8453,
    window: { from: time, to: time }, currency: "USD", transfers: [], nextCursor: null,
    source: { provider: "cdp-sql", cached: false, stale: false, executionTimestamp: time, executionTimeMs: 1, fetchedAt: time } },
  loadingMore: false, loadMoreError: false, continuing: false, retry: noop, refresh: noop, setSentinelVisible: noop, retryLoadMore: noop,
};
const metadata = { product: "cashout", operation: "deposit", providerId: "peer", providerName: "Peer", environment: "sandbox", platform: "cashapp", platformLabel: "Cash App", currency: "USD", canonicalHandle: "fixture-payee", approximateFiatAmount: "50.00", etaSeconds: 3600, minConversionRate: "1", intentAmountRange: { min: "50000000", max: "50000000" }, estimateAsOf: time, escrow: "0x777777779d229cdF3110e9de47943791c26300Ef" } as const;
const progress = { version: 1, providerId: "peer", region: "US", depositId: "fixture-escrow-1", platform: "cashapp", platformLabel: "Cash App", amountAtomic: "50000000", filledAtomic: "0", returnedAtomic: "0", remainingAtomic: "50000000", withdrawable: true, withdrawing: false, etaSeconds: 3600, settledAt: null, updatedAt: time } as const;
function operation(state: NonNullable<RecentMoneyActionOperation["cashout"]>["state"], id: string): RecentMoneyActionOperation {
  return {
    action: { id, kind: "cash-out", title: "Cash out with Peer", amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "50000000", direction: "spend" }], warnings: [], expiresAt: time, createdAt: time, metadata },
    status: state === "failed" ? "failed" : "confirmed", cashout: { ...progress, state, depositId: id }, createdAt: time, updatedAt: time,
  };
}
const states = [
  operation("awaiting-buyer", "waiting"), operation("matched", "paying"),
  { ...operation("awaiting-buyer", "partial"), cashout: { ...progress, depositId: "partial", state: "awaiting-buyer" as const, filledAtomic: "30000000", remainingAtomic: "20000000" } },
  operation("delivered", "paid"), operation("returned", "returned"),
  { ...operation("delivered", "partial-return"), cashout: { ...progress, depositId: "partial-return", state: "delivered" as const, filledAtomic: "30000000", returnedAtomic: "20000000", remainingAtomic: "0" } },
  operation("failed", "failed"),
];
const meta = { title: "Journeys/Cash-out activity", component: ActivityPanelView, parameters: { layout: "centered" } } satisfies Meta<typeof ActivityPanelView>;
export default meta;
type Story = StoryObj<typeof meta>;
export const States: Story = {
  args: { activity, operations: states, regionId: "US", density: "page", onCancelCashout: noop },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Waiting for a buyer/)).toBeVisible();
    await expect(canvas.getByText(/Buyer paying you/)).toBeVisible();
    await expect(canvas.getByText(/Paid to Cash App/)).toBeVisible();
    await expect(canvas.getByText(/Cash-out failed/)).toBeVisible();
  },
};
export const CancelDetails: Story = {
  args: { activity, operations: [states[0]!], regionId: "US", density: "page", onCancelCashout: noop },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /\$50 to Cash App.*Waiting for a buyer/ }));
    const dialog = await within(document.body).findByRole("dialog", { name: "$50 to Cash App" });
    await expect(within(dialog).getByRole("button", { name: "Cancel cash-out $50" })).toBeVisible();
    await expect(within(dialog).getByText("About 60 min")).toBeVisible();
  },
};
