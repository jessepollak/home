import "server-only";

import {
  ACTIVITY_PAGE_SIZE,
  ACTIVITY_WINDOW_DAYS,
  activityAssets,
  type ActivityPage,
  type ActivityTransferValuation,
} from "@/shared/activity/types";
import { registryActivityTokenMetadata } from "@/shared/activity/metadata";
import { createBaseErc20TransferHistory } from "@/server/chain-data/base-erc20-transfers";
import {
  createCdpAddressHistory,
  createCdpAddressHistoryFromEnv,
} from "@/server/chain-data/cdp-address-history";
import {
  createCdpSqlAuthFromEnv,
  createCdpSqlHttpTransport,
} from "@/server/chain-data/cdp-sql-client";
import { ChainDataError } from "@/server/chain-data/errors";
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
import {
  getActivityTransferValuer,
  valueTransfersWithoutQuotes,
  type ActivityTransferValuer,
  type UnvaluedActivityTransfer,
} from "./valuation/value-transfers";
import { unpricedActivityValuation } from "@/shared/activity/valuation";

export const ACTIVITY_VALUATION_BUDGET_MS = 3_500;

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

export const ACTIVITY_HISTORY_SOURCES = [
  "cdp-sql",
  "cdp-address-history",
] as const;
export type ActivityHistorySource = (typeof ACTIVITY_HISTORY_SOURCES)[number];

const windowMs = ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
type MetadataResolver = (
  addresses: readonly `0x${string}`[],
  signal?: AbortSignal,
) => Promise<ActivityTokenMetadataResolution>;

export function createActivityReader(
  listTransfers: TransferLister,
  resolveMetadata: MetadataResolver = resolveActivityTokenMetadata,
  valueTransfers: ActivityTransferValuer = (transfers, currency, signal) =>
    getActivityTransferValuer()(transfers, currency, signal),
  valuationBudgetMs = ACTIVITY_VALUATION_BUDGET_MS,
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

    const unvalued: UnvaluedActivityTransfer[] = page.transfers.flatMap((transfer) => {
      const address = transfer.tokenAddress.toLowerCase();
      if (resolution.nftLikeContracts.has(address)) return [];
      const token = resolution.metadata.get(address) ?? {
        assetId: null,
        tokenSymbol: null,
        tokenDecimals: null,
      };
      return [{ ...transfer, ...token }];
    });
    const valuations = await valueWithinBudget(
      valueTransfers,
      unvalued,
      request.currency,
      valuationBudgetMs,
      signal,
    );

    return {
      walletAddress: account.address.toLowerCase() as `0x${string}`,
      chainId: 8453,
      window: { from, to: request.to },
      currency: request.currency,
      transfers: unvalued.map((transfer, index) => ({
        ...transfer,
        valuation:
          valuations[index] ??
          unpricedActivityValuation(request.currency, "quote-unavailable"),
      })),
      nextCursor: page.nextCursor,
      source: page.source,
    };
  };
}

async function valueWithinBudget(
  valueTransfers: ActivityTransferValuer,
  transfers: readonly UnvaluedActivityTransfer[],
  currency: ActivityReadRequest["currency"],
  budgetMs: number,
  signal?: AbortSignal,
): Promise<ActivityTransferValuation[]> {
  if (transfers.length === 0) return [];
  const unavailable = () => valueTransfersWithoutQuotes(transfers, currency);
  const budget = new AbortController();
  const abortFromRequest = () => budget.abort(signal?.reason);
  if (signal?.aborted) abortFromRequest();
  else signal?.addEventListener("abort", abortFromRequest, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      valueTransfers(transfers, currency, budget.signal),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), budgetMs);
      }),
    ]);
    return result && result.length === transfers.length ? result : unavailable();
  } catch (error) {
    void error;
    return unavailable();
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromRequest);
    budget.abort();
  }
}

export function resolveActivityHistorySource(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ActivityHistorySource {
  const configured = env.ACTIVITY_HISTORY_SOURCE === undefined
    ? "cdp-sql"
    : env.ACTIVITY_HISTORY_SOURCE.trim();
  if (
    configured !== "cdp-sql" &&
    configured !== "cdp-address-history"
  ) {
    throw new ChainDataError(
      "not-configured",
      "ACTIVITY_HISTORY_SOURCE must be cdp-sql or cdp-address-history.",
    );
  }
  return configured;
}

export const getRecentBaseActivity: ActivityReader = async (
  account,
  request,
  signal,
) => {
  const assets = activityAssets.map((asset) => ({
    id: asset.id,
    chainId: 8453 as const,
    address: asset.tokenAddress,
  }));
  const source = resolveActivityHistorySource();
  const history = source === "cdp-address-history"
    ? createCdpAddressHistory({
        assets,
        transport: createCdpAddressHistoryFromEnv(process.env, {
          timeoutMs: 6_000,
        }),
      })
    : createBaseErc20TransferHistory({
        assets,
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
