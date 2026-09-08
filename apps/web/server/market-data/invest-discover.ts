import type { InvestAsset } from "@/config/invest-assets";
import type { MarketSnapshot } from "@/features/invest/invest-market";
import {
  createAssetIconResolver,
  emptyAssetIconMap,
  type AssetIconMap,
} from "./asset-icons/resolve";
import {
  createCodexTrendingMemesReader,
  createErrorTrendingMemes,
  createUnavailableTrendingMemes,
  type TrendingMemesResult,
} from "./codex/trending";
import { INVEST_DISCOVER_VERSION } from "./invest-discover-contract";

export { INVEST_DISCOVER_VERSION };

export type InvestDiscoverResponse = {
  version: typeof INVEST_DISCOVER_VERSION;
  provider: "codex";
  fetchedAt: string | null;
  icons: AssetIconMap;
  memes: {
    status: TrendingMemesResult["status"];
    message?: string;
    assets: InvestAsset[];
    snapshots: MarketSnapshot[];
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
  const readMemes = createCodexTrendingMemesReader({ apiKey, fetchImpl, now });

  return async function readInvestDiscover(): Promise<InvestDiscoverResponse> {
    const fetchedAt = now().toISOString();
    const [icons, memes] = await Promise.all([
      readIcons().catch(() => emptyAssetIconMap()),
      readMemes().catch(() =>
        createErrorTrendingMemes("Trending memes are unavailable."),
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
      },
    };
  };
}

let sharedReader: ReturnType<typeof createInvestDiscoverReader> | null = null;
let sharedKey: string | undefined;

export function getInvestDiscover(): Promise<InvestDiscoverResponse> {
  const apiKey = process.env.CODEX_API_KEY;
  if (!sharedReader || sharedKey !== apiKey) {
    sharedKey = apiKey;
    sharedReader = createInvestDiscoverReader({ apiKey });
  }
  return sharedReader();
}

export function createUnavailableInvestDiscover(): InvestDiscoverResponse {
  return {
    version: INVEST_DISCOVER_VERSION,
    provider: "codex",
    fetchedAt: null,
    icons: emptyAssetIconMap(),
    memes: createUnavailableTrendingMemes(),
  };
}

export function createErrorInvestDiscover(): InvestDiscoverResponse {
  return {
    version: INVEST_DISCOVER_VERSION,
    provider: "codex",
    fetchedAt: null,
    icons: emptyAssetIconMap(),
    memes: createErrorTrendingMemes(),
  };
}
