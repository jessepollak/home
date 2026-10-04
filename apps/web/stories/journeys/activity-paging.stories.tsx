import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { ActivityPanelView } from "@/client/activity";
import type { UseActivityResult } from "@/client/activity/use-activity";
import type { ActivityTransfer } from "@/shared/activity/types";
import { computeActivityValuationAmount } from "@/shared/activity/valuation";

const wallet = "0x1111111111111111111111111111111111111111" as const;
const other = "0x2222222222222222222222222222222222222222" as const;
const token = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const timestamp = "2026-09-26T12:00:00.000Z";
const noop = () => {};
const transfers: ActivityTransfer[] = Array.from({ length: 12 }, (_, index) => ({
  id: `8453:${token}:paging-${index}`, logId: `paging-${index}`, chainId: 8453,
  assetId: "usdc", tokenAddress: token, tokenSymbol: "USDC", tokenDecimals: 6,
  tokenImageUrl: null, walletAddress: wallet,
  fromAddress: index % 2 ? wallet : other, toAddress: index % 2 ? other : wallet,
  direction: index % 2 ? "outgoing" : "incoming", amountBaseUnits: "1000000",
  blockNumber: String(100 - index), blockHash: `0x${(100 - index).toString(16).padStart(64, "0")}`,
  transactionHash: `0x${index.toString(16).padStart(64, "0")}`, logIndex: "0",
  blockTimestamp: new Date(Date.parse(timestamp) - index * 60_000).toISOString(),
  valuation: {
    status: "priced", currency: "USD", method: "peg", peg: "USD", close: null, fx: null,
    amount: computeActivityValuationAmount({ amountBaseUnits: "1000000", tokenDecimals: 6, unitPrice: null, fxRate: null }),
  },
}));

type PagingState = "idle" | "loading" | "error" | "end";
function PagingJourney({ state = "idle", density = "page" }: { state?: PagingState; density?: "page" | "feed" }) {
  const [retried, setRetried] = useState(false);
  const current = retried ? "end" : state;
  const activity: UseActivityResult = {
    status: "ready",
    page: {
      walletAddress: wallet, chainId: 8453,
      window: { from: "2026-08-26T12:00:00.000Z", to: timestamp }, currency: "USD",
      transfers, nextCursor: current === "end" ? null : "older-page",
      source: { provider: "cdp-sql", cached: false, stale: false, executionTimestamp: timestamp, executionTimeMs: 1, fetchedAt: timestamp },
    },
    loadingMore: current === "loading", continuing: current === "loading", loadMoreError: current === "error",
    retry: noop, refresh: noop, setSentinelVisible: noop, retryLoadMore: () => setRetried(true),
  };
  return <main className="mx-auto max-w-2xl p-4"><ActivityPanelView activity={activity} density={density} /></main>;
}

const meta = {
  id: "journeys-activity-paging", title: "Journeys/Activity paging", component: PagingJourney,
  parameters: { viewport: { defaultViewport: "mobile" } },
} satisfies Meta<typeof PagingJourney>;
export default meta;
type Story = StoryObj<typeof meta>;
export const IdleWithMore: Story = { args: { state: "idle" } };
export const LoadingOlder: Story = {
  args: { state: "loading" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement);
    await expect(screen.getByRole("status")).toHaveTextContent("Loading older activity");
    await expect(screen.queryByText("End of activity")).toBeNull();
  },
};
export const LaterPageRetry: Story = {
  args: { state: "error" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement);
    await expect(screen.getByRole("alert")).toHaveTextContent("More activity could not be loaded");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await expect(screen.getByRole("status")).toHaveTextContent("End of activity");
    await expect(screen.queryByRole("alert")).toBeNull();
  },
};
export const EndOfHistory: Story = { args: { state: "end" } };
export const FeedLoadingOlder: Story = { args: { state: "loading", density: "feed" } };
export const FeedEndOfHistory: Story = { args: { state: "end", density: "feed" } };
