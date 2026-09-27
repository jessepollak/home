import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ActivityPanelView } from "@/client/activity";
import type { UseActivityResult } from "@/client/activity/use-activity";
import { canonicalUsdcAsset, investPortfolioAssets } from "@/config/portfolio-assets";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { ActivityTransfer } from "@/shared/activity/types";
import { computeActivityValuationAmount } from "@/shared/activity/valuation";

const wallet = "0x1111111111111111111111111111111111111111" as const;
const counterparty = "0x2222222222222222222222222222222222222222" as const;
const cbbtc = investPortfolioAssets.find((asset) => asset.id === "cbbtc")!;
const usdPrice = { atoms: "60000", scale: 0 };
const noop = () => {};

type Token = typeof canonicalUsdcAsset | typeof cbbtc;
function transfer(
  index: number,
  token: Token,
  amountBaseUnits: string,
  blockTimestamp: string,
  direction: "incoming" | "outgoing" = "incoming",
  unpriced = false,
): ActivityTransfer {
  const tokenAddress = token.contractAddress!;
  const hash = `0x${index.toString(16).padStart(64, "0")}` as const;
  const valuation: ActivityTransfer["valuation"] = unpriced
    ? { status: "unpriced", currency: "USD", reason: "quote-unavailable" }
    : token.id === "usdc"
      ? {
          status: "priced", currency: "USD", method: "peg", peg: "USD", close: null, fx: null,
          amount: computeActivityValuationAmount({
            amountBaseUnits, tokenDecimals: token.decimals, unitPrice: null, fxRate: null,
          }),
        }
      : {
          status: "priced", currency: "USD", method: "historical-close", peg: null, fx: null,
          amount: computeActivityValuationAmount({
            amountBaseUnits, tokenDecimals: token.decimals, unitPrice: usdPrice, fxRate: null,
          }),
          close: {
            provider: "Codex", closedAt: new Date(Date.parse(blockTimestamp) - 15 * 60_000).toISOString(),
            resolutionMinutes: 15, priceUsd: usdPrice,
          },
        };
  return {
    id: `8453:${tokenAddress.toLowerCase()}:${index}`,
    logId: `fixture-log-${index}`,
    chainId: 8453,
    assetId: token.id,
    tokenAddress,
    tokenSymbol: token.symbol,
    tokenDecimals: token.decimals,
    tokenImageUrl: null,
    walletAddress: wallet,
    fromAddress: direction === "incoming" ? counterparty : wallet,
    toAddress: direction === "incoming" ? wallet : counterparty,
    direction,
    amountBaseUnits,
    blockNumber: String(50_000_000 - index),
    blockHash: `0x${(50_000_000 - index).toString(16).padStart(64, "0")}`,
    transactionHash: hash,
    logIndex: "0",
    blockTimestamp,
    valuation,
  };
}

const transfers: ActivityTransfer[] = [
  transfer(1, canonicalUsdcAsset, "100000000", "2026-09-24T12:00:00.000Z"),
  transfer(2, canonicalUsdcAsset, "200000000", "2026-09-23T12:00:00.000Z"),
  transfer(3, canonicalUsdcAsset, "300000000", "2026-09-22T12:00:00.000Z"),
  transfer(4, canonicalUsdcAsset, "400000000", "2026-09-21T12:00:00.000Z"),
  transfer(5, cbbtc, "200000", "2026-09-20T12:00:00.000Z"),
  transfer(6, canonicalUsdcAsset, "20000000", "2026-09-19T12:00:00.000Z"),
  transfer(7, canonicalUsdcAsset, "30000000", "2026-09-18T12:00:00.000Z"),
  transfer(8, canonicalUsdcAsset, "10000000", "2026-09-17T12:00:00.000Z", "outgoing"),
  transfer(9, cbbtc, "100000", "2026-09-16T12:00:00.000Z"),
  transfer(10, cbbtc, "200000", "2026-09-15T12:00:00.000Z", "incoming", true),
  transfer(11, cbbtc, "300000", "2026-09-14T12:00:00.000Z"),
];

const pendingSend: RecentMoneyActionOperation = {
  action: {
    id: "fixture-pending-send", kind: "send", title: "Sent USDC",
    amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "25000000", direction: "spend" }],
    warnings: [], createdAt: "2026-09-26T12:00:00.000Z", expiresAt: "2026-09-26T13:00:00.000Z",
  },
  status: "pending",
  createdAt: "2026-09-26T12:00:00.000Z",
  updatedAt: "2026-09-26T12:00:00.000Z",
};

function activity(records: ActivityTransfer[]): UseActivityResult {
  const to = "2026-09-26T12:00:00.000Z";
  return {
    status: "ready",
    page: {
      walletAddress: wallet, chainId: 8453,
      window: { from: "2026-08-26T12:00:00.000Z", to }, currency: "USD",
      transfers: records, nextCursor: null,
      source: { provider: "cdp-sql", cached: false, stale: false, executionTimestamp: to, executionTimeMs: 1, fetchedAt: to },
    },
    loadingMore: false, loadMoreError: false, continuing: false,
    retry: noop, refresh: noop, setSentinelVisible: noop, retryLoadMore: noop,
  };
}

const longTransfers: ActivityTransfer[] = [
  ...Array.from({ length: 60 }, (_, index) => transfer(
    index + 100,
    canonicalUsdcAsset,
    "1000000",
    new Date(Date.parse("2026-09-25T12:00:00.000Z") - index * 2 * 60 * 60_000).toISOString(),
  )),
  transfer(160, cbbtc, "100000", "2026-09-19T12:00:00.000Z"),
  transfer(161, canonicalUsdcAsset, "5000000", "2026-09-18T12:00:00.000Z", "outgoing"),
  transfer(162, cbbtc, "200000", "2026-09-17T12:00:00.000Z"),
];

const meta = {
  id: "journeys-activity-transfer-runs",
  title: "Journeys/Activity transfer runs",
  component: ActivityPanelView,
  decorators: [(Story) => <main className="mx-auto w-full max-w-2xl p-4"><Story /></main>],
  parameters: { layout: "fullscreen", viewport: { defaultViewport: "mobile" } },
} satisfies Meta<typeof ActivityPanelView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const HomeFeedMobile: Story = {
  args: {
    activity: activity(transfers), operations: [pendingSend], regionId: "US", density: "feed",
    header: <h2 id="activity-title" className="text-lg font-semibold">Activity</h2>,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const screen = within(canvasElement.ownerDocument.body);
    const pending = canvas.getByRole("list", { name: "Pending" });
    const recent = canvas.getByRole("list", { name: "Recent" });
    await expect(within(pending).getByRole("button", { description: "View Sent USDC transaction details" })).toBeVisible();
    await expect(within(pending).getAllByRole("button")).toHaveLength(1);
    await expect(within(pending).queryByRole("button", { description: /transfers$/ })).toBeNull();

    const summary = within(recent).getByRole("button", { description: "4 Received USDC transfers" });
    await expect(summary).toHaveTextContent("Received ×4");
    await expect(within(summary).getByRole("img", { name: "+$1,000.00" })).toBeVisible();
    await expect(summary).toHaveTextContent("Sep 21 – 24");
    await expect(within(recent).getByRole("button", { description: "2 Received USDC transfers" })).toBeVisible();
    const bitcoinRun = within(recent).getByRole("button", { description: "3 Received cbBTC transfers" });
    await expect(bitcoinRun).toHaveTextContent("+0.006 cbBTC");
    await expect(bitcoinRun).not.toHaveTextContent("$");

    summary.focus();
    await userEvent.keyboard("{Enter}");
    await expect(summary).toHaveAttribute("aria-expanded", "true");
    const controlledId = summary.getAttribute("aria-controls")!;
    await expect(controlledId).toBe(recent.id);
    await expect(canvasElement.ownerDocument.getElementById(controlledId)).toBe(recent);
    const children = within(recent).getAllByRole("button", { description: "View received USDC transaction details" });
    await expect(children).toHaveLength(4);
    await userEvent.click(children[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Received" });
    await expect(dialog).toBeVisible();
    await userEvent.click(within(dialog).getByRole("button", { name: "Close Received details" }));
    await waitFor(() => expect(children[0]).toHaveFocus());
    summary.focus();
    await userEvent.keyboard(" ");
    await expect(summary).toHaveAttribute("aria-expanded", "false");
    await expect(summary).not.toHaveAttribute("aria-controls");
    await expect(canvasElement.ownerDocument.getElementById(controlledId)).toBe(recent);
    await expect(within(recent).queryByRole("button", { description: "View received USDC transaction details" })).toBeNull();
  },
};

export const ActivityPageDesktop: Story = {
  args: { activity: activity(transfers), operations: [pendingSend], regionId: "US", density: "page", header: null },
  parameters: { viewport: { defaultViewport: "desktop" } },
};

export const ActivityPageMobile: Story = {
  args: { activity: activity(transfers), operations: [pendingSend], regionId: "US", density: "page", header: null },
};

export const LongRunScroll: Story = {
  args: { activity: activity(longTransfers), operations: [pendingSend], regionId: "US", density: "page", header: null },
  play: async ({ canvasElement }) => {
    const recent = within(canvasElement).getByRole("list", { name: "Recent" });
    await expect(within(recent).getByRole("button", { description: "60 Received USDC transfers" }))
      .toHaveTextContent("Received ×60");
  },
};
