import "server-only";

import {
  ACTIVITY_PAGE_SIZE,
  ACTIVITY_WINDOW_DAYS,
  activityAssets,
  type ActivityPage,
} from "@/shared/activity/types";
import { registryActivityTokenMetadata } from "@/shared/activity/metadata";
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
import {
  resolveActivityTokenMetadata,
  type ActivityTokenMetadataResolution,
} from "./token-metadata";

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
type MetadataResolver = (
  addresses: readonly `0x${string}`[],
  signal?: AbortSignal,
) => Promise<ActivityTokenMetadataResolution>;

export function createActivityReader(
  listTransfers: TransferLister,
  resolveMetadata: MetadataResolver = resolveActivityTokenMetadata,
): ActivityReader {
  return async function readActivity(
    account: VerifiedActivityAccount,
    request: ActivityReadRequest,
    signal?: AbortSignal,
  ): Promise<ActivityPage> {
    const to = new Date(request.to);
    const from = new Date(to.getTime() - windowMs).toISOString();
    const page = await listTransfers({
      verifiedWalletAddress: account.address,
      assetIds: [],
      includeUnknownAssets: true,
      from,
      to: request.to,
      limit: ACTIVITY_PAGE_SIZE,
      cursor: request.cursor,
      cacheMaxAgeMs: 15_000,
      staleAfterMs: 60_000,
      signal,
    });

    const addresses = [...new Set(page.transfers.map((transfer) =>
      transfer.tokenAddress.toLowerCase() as `0x${string}`,
    ))];
    let resolution: ActivityTokenMetadataResolution;
    try {
      resolution = await resolveMetadata(addresses, signal);
    } catch {
      resolution = {
        metadata: new Map(addresses.map((address) => [
          address,
          registryActivityTokenMetadata(address) ?? {
            assetId: null,
            tokenSymbol: null,
            tokenDecimals: null,
          },
        ])),
        nftLikeContracts: new Set(),
      };
    }

    return {
      walletAddress: account.address.toLowerCase() as `0x${string}`,
      chainId: 8453,
      window: { from, to: request.to },
      transfers: page.transfers.flatMap((transfer) => {
        const address = transfer.tokenAddress.toLowerCase();
        if (resolution.nftLikeContracts.has(address)) return [];
        const token = resolution.metadata.get(address) ?? {
          assetId: null,
          tokenSymbol: null,
          tokenDecimals: null,
        };
        return [{ ...transfer, ...token }];
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
