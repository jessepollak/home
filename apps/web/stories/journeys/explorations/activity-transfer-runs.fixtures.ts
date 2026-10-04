import type { UseActivityResult } from "@/client/activity/use-activity";
import { canonicalUsdcAsset, investPortfolioAssets } from "@/config/portfolio-assets";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { ActivityTransfer } from "@/shared/activity/types";
import { computeActivityValuationAmount } from "@/shared/activity/valuation";

const wallet: `0x${string}` = "0x1111111111111111111111111111111111111111";
const counterparty: `0x${string}` = "0x2222222222222222222222222222222222222222";
const usdPrice = { atoms: "60000", scale: 0 };
const noop = () => {};
const cbbtc = investPortfolioAssets.find((asset) => asset.id === "cbbtc");
if (!cbbtc) throw new Error("cbBTC portfolio asset is required");

function transfer(index: number, token: typeof canonicalUsdcAsset, amountBaseUnits: string,
  blockTimestamp: string, direction: "incoming" | "outgoing" = "incoming", unpriced = false): ActivityTransfer {
  const tokenAddress = token.contractAddress;
  if (!tokenAddress) throw new Error("Transfer asset contract is required");
  const hash: `0x${string}` = `0x${index.toString(16).padStart(64, "0")}`;
  const valuation: ActivityTransfer["valuation"] = unpriced
    ? { status: "unpriced", currency: "USD", reason: "quote-unavailable" }
    : token.id === "usdc"
      ? { status: "priced", currency: "USD", method: "peg", peg: "USD", close: null, fx: null,
          amount: computeActivityValuationAmount({ amountBaseUnits, tokenDecimals: token.decimals, unitPrice: null, fxRate: null }) }
      : { status: "priced", currency: "USD", method: "historical-close", peg: null, fx: null,
          amount: computeActivityValuationAmount({ amountBaseUnits, tokenDecimals: token.decimals, unitPrice: usdPrice, fxRate: null }),
          close: { provider: "Codex", closedAt: new Date(Date.parse(blockTimestamp) - 15 * 60_000).toISOString(), resolutionMinutes: 15, priceUsd: usdPrice } };
  return {
    id: `8453:${tokenAddress.toLowerCase()}:${index}`, logId: `fixture-log-${index}`, chainId: 8453,
    assetId: token.id, tokenAddress, tokenSymbol: token.symbol, tokenDecimals: token.decimals, tokenImageUrl: null,
    walletAddress: wallet, fromAddress: direction === "incoming" ? counterparty : wallet,
    toAddress: direction === "incoming" ? wallet : counterparty, direction, amountBaseUnits,
    blockNumber: String(50_000_000 - index), blockHash: `0x${(50_000_000 - index).toString(16).padStart(64, "0")}`,
    transactionHash: hash, logIndex: "0", blockTimestamp, valuation,
  };
}

export const transfers: ActivityTransfer[] = [
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
export const pendingSend: RecentMoneyActionOperation = {
  action: { id: "fixture-pending-send", kind: "send", title: "Sent USDC",
    amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "25000000", direction: "spend" }],
    warnings: [], createdAt: "2026-09-26T12:00:00.000Z", expiresAt: "2026-09-26T13:00:00.000Z" },
  status: "pending", createdAt: "2026-09-26T12:00:00.000Z", updatedAt: "2026-09-26T12:00:00.000Z",
};

export function activity(records: ActivityTransfer[]): Extract<UseActivityResult, { status: "ready" }> {
  const to = "2026-09-26T12:00:00.000Z";
  return {
    status: "ready",
    page: { walletAddress: wallet, chainId: 8453, window: { from: "2026-08-26T12:00:00.000Z", to }, currency: "USD",
      transfers: records, nextCursor: null,
      source: { provider: "cdp-sql", cached: false, stale: false, executionTimestamp: to, executionTimeMs: 1, fetchedAt: to } },
    loadingMore: false, loadMoreError: false, continuing: false,
    retry: noop, refresh: noop, setSentinelVisible: noop, retryLoadMore: noop,
  };
}

export const longTransfers: ActivityTransfer[] = [
  ...Array.from({ length: 60 }, (_, index) => transfer(index + 100, canonicalUsdcAsset, "1000000",
    new Date(Date.parse("2026-09-25T12:00:00.000Z") - index * 2 * 60 * 60_000).toISOString())),
  transfer(160, cbbtc, "100000", "2026-09-19T12:00:00.000Z"),
  transfer(161, canonicalUsdcAsset, "5000000", "2026-09-18T12:00:00.000Z", "outgoing"),
  transfer(162, cbbtc, "200000", "2026-09-17T12:00:00.000Z"),
];
