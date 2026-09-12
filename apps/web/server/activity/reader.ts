import {
  ACTIVITY_PAGE_SIZE,
  ACTIVITY_WINDOW_DAYS,
  activityAssets,
  type ActivityAsset,
  type ActivityPage,
} from "@/shared/activity/types";
import { createBaseErc20TransferHistory } from "@/server/chain-data/base-erc20-transfers";
import {
  createCdpSqlAuthFromEnv,
  createCdpSqlHttpTransport,
} from "@/server/chain-data/cdp-sql-client";
import type { BaseErc20TransferPage } from "@/server/chain-data/types";
import type {
  ActivityReadRequest,
  ActivityReader,
  VerifiedActivityAccount,
} from "./types";

type TransferLister = (input: {
  verifiedWalletAddress: string;
  assetIds: readonly string[];
  includeUnknownAssets?: boolean;
  from: string;
  to: string;
  limit: number;
  cursor: string | null;
  cacheMaxAgeMs: number;
  staleAfterMs: number;
  signal?: AbortSignal;
}) => Promise<BaseErc20TransferPage>;

const windowMs = ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const assetsByContract = new Map<string, ActivityAsset>(
  activityAssets.map((asset) => [asset.tokenAddress.toLowerCase(), asset]),
);

export function createActivityReader(listTransfers: TransferLister): ActivityReader {
  return async function readActivity(
    account: VerifiedActivityAccount,
    request: ActivityReadRequest,
    signal?: AbortSignal,
  ): Promise<ActivityPage> {
    const to = new Date(request.to);
    const from = new Date(to.getTime() - windowMs).toISOString();
    const page = await listTransfers({
      verifiedWalletAddress: account.address,
      assetIds: activityAssets.map((asset) => asset.id),
      from,
      to: request.to,
      limit: ACTIVITY_PAGE_SIZE,
      cursor: request.cursor,
      cacheMaxAgeMs: 15_000,
      staleAfterMs: 60_000,
      signal,
    });

    return {
      walletAddress: account.address.toLowerCase() as `0x${string}`,
      chainId: 8453,
      window: { from, to: request.to },
      transfers: page.transfers.map((transfer) => {
        const asset = assetsByContract.get(transfer.tokenAddress.toLowerCase());
        return {
          ...transfer,
          assetId: asset?.id ?? null,
          tokenSymbol: asset?.symbol ?? null,
          tokenDecimals: asset?.decimals ?? null,
        };
      }),
      nextCursor: page.nextCursor,
      source: page.source,
    };
  };
}

export const getRecentBaseActivity: ActivityReader = async (
  account,
  request,
  signal,
) => {
  const history = createBaseErc20TransferHistory({
    assets: activityAssets.map((asset) => ({
      id: asset.id,
      chainId: 8453,
      address: asset.tokenAddress,
    })),
    transport: createCdpSqlHttpTransport({
      auth: createCdpSqlAuthFromEnv(),
      timeoutMs: 20_000,
    }),
  });
  return createActivityReader((input) => history.listTransfers(input))(
    account,
    request,
    signal,
  );
};
