import "server-only";

import type { InvestAsset } from "@/config/invest-assets";
import type { MarketSnapshot } from "@/shared/invest/invest-market";
import {
  createAssetIconResolver,
  emptyAssetIconMap,
  type AssetIconMap,
} from "./asset-icons/resolve";
import {
  createCodexTrendingMemesPageReader,
  createErrorTrendingMemesPage,
  createUnavailableTrendingMemesPage,
  type TrendingMemesStatus,
} from "./codex/trending";
import { INVEST_DISCOVER_VERSION } from "@/shared/invest/invest-discover-contract";

export { INVEST_DISCOVER_VERSION };

export type InvestDiscoverResponse = {
  version: typeof INVEST_DISCOVER_VERSION;
  provider: "codex";
  fetchedAt: string | null;
  icons: AssetIconMap;
  memes: {
    status: TrendingMemesStatus;
    message?: string;
    assets: InvestAsset[];
    snapshots: MarketSnapshot[];
    /** Truthful offset for the next page, or null when the catalog is exhausted. */
    nextOffset: number | null;
    /** True once the provider returned fewer rows than the bounded page size. */
    exhausted: boolean;
  };
};

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type Clock = () => Date;

export function createInvestDiscoverReader({
  apiKey,
  fetchImpl = fetch,
  now = () => new Date(),
}: {
  apiKey: string | undefined;
  fetchImpl?: FetchLike;
  now?: Clock;
}) {
  const readIcons = createAssetIconResolver({ apiKey, fetchImpl, now });
  const readMemesPage = createCodexTrendingMemesPageReader({
    apiKey,
    fetchImpl,
    now,
  });

  return async function readInvestDiscover(
    offset = 0,
  ): Promise<InvestDiscoverResponse> {
    const fetchedAt = now().toISOString();
    const [icons, memes] = await Promise.all([
      readIcons().catch(() => emptyAssetIconMap()),
      readMemesPage(offset).catch(() =>
        createErrorTrendingMemesPage("Trending memes are unavailable."),
      ),
    ]);

    return {
      version: INVEST_DISCOVER_VERSION,
      provider: "codex",
      fetchedAt: memes.status === "unavailable" ? null : fetchedAt,
      icons,
      memes: {
        status: memes.status,
        ...(memes.message ? { message: memes.message } : {}),
        assets: memes.assets,
        snapshots: memes.snapshots,
        nextOffset: memes.nextOffset,
        exhausted: memes.exhausted,
      },
    };
  };
}

let sharedReader: ReturnType<typeof createInvestDiscoverReader> | null = null;
let sharedKey: string | undefined;

export function getInvestDiscover(
  offset = 0,
): Promise<InvestDiscoverResponse> {
  const apiKey = process.env.CODEX_API_KEY;
  if (!sharedReader || sharedKey !== apiKey) {
    sharedKey = apiKey;
    sharedReader = createInvestDiscoverReader({ apiKey });
  }
  return sharedReader(offset);
}

export function createUnavailableInvestDiscover(): InvestDiscoverResponse {
  return {
    version: INVEST_DISCOVER_VERSION,
    provider: "codex",
    fetchedAt: null,
    icons: emptyAssetIconMap(),
    memes: createUnavailableTrendingMemesPage(),
  };
}

export function createErrorInvestDiscover(): InvestDiscoverResponse {
  return {
    version: INVEST_DISCOVER_VERSION,
    provider: "codex",
    fetchedAt: null,
    icons: emptyAssetIconMap(),
    memes: createErrorTrendingMemesPage(),
  };
}
