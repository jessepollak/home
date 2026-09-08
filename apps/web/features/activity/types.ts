import type { ReactNode } from "react";
import type { VerifiedAccountSession } from "@/features/account/session-types";
import { cryptoAssets } from "@/config/invest-assets";

export const ACTIVITY_BASE_CHAIN_ID = 8453 as const;
export const ACTIVITY_PAGE_SIZE = 25 as const;
export const ACTIVITY_WINDOW_DAYS = 31 as const;

export const activityAssets = [
  {
    id: "usdc" as const,
    symbol: "USDC" as const,
    decimals: 6 as const,
    tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const,
  },
  ...cryptoAssets.map((asset) => ({
    id: asset.id,
    symbol: asset.representation.tokenSymbol,
    decimals: asset.representation.decimals,
    tokenAddress: asset.contractAddress,
  })),
] as const;

export type ActivityAsset = (typeof activityAssets)[number];
export type ActivityAssetId = ActivityAsset["id"];
export type ActivityDirection = "incoming" | "outgoing" | "self";

export type ActivityTransfer = {
  id: string;
  chainId: typeof ACTIVITY_BASE_CHAIN_ID;
  assetId: ActivityAssetId;
  tokenAddress: `0x${string}`;
  walletAddress: `0x${string}`;
  fromAddress: `0x${string}`;
  toAddress: `0x${string}`;
  direction: ActivityDirection;
  amountBaseUnits: string;
  blockNumber: string;
  blockHash: `0x${string}`;
  transactionHash: `0x${string}`;
  logIndex: string;
  blockTimestamp: string;
};

export type ActivitySource = {
  provider: "cdp-sql";
  cached: boolean;
  stale: boolean;
  executionTimestamp: string;
  executionTimeMs: number;
  fetchedAt: string;
};

export type ActivityPage = {
  walletAddress: `0x${string}`;
  chainId: typeof ACTIVITY_BASE_CHAIN_ID;
  window: {
    from: string;
    to: string;
  };
  transfers: ActivityTransfer[];
  nextCursor: string | null;
  source: ActivitySource;
};

export type ActivityReadyState = {
  status: "ready";
  page: ActivityPage;
  loadingMore: boolean;
  loadMoreError: boolean;
};

export type ActivityState =
  | { status: "unavailable"; page: null; loadingMore: false; loadMoreError: false }
  | { status: "loading"; page: null; loadingMore: false; loadMoreError: false }
  | { status: "error"; page: null; loadingMore: false; loadMoreError: false }
  | ActivityReadyState;

export type FetchActivity = (
  query: string,
  signal?: AbortSignal,
) => Promise<unknown>;

export type ActivityPanelProps = {
  session: VerifiedAccountSession | null;
  fetchActivity: FetchActivity;
  refreshTrigger?: string | number;
  onTransactionHashesChange?: (hashes: string[]) => void;
  leading?: ReactNode;
  suppressEmpty?: boolean;
};
