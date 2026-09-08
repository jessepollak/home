import { cryptoAssets, stockAssets } from "@/config/invest-assets";
import { readCodexTokenImages, contractKey } from "../codex/token-images";
import type { FetchLike } from "../codex/execute";
import { CODEX_REQUEST_TIMEOUT_MS } from "../codex/config";
import { readOnchainIconImages } from "./onchain";

export type AssetIconMap = Record<string, string | null>;

const ICON_CACHE_TTL_MS = 60 * 60 * 1_000;
const configuredIconAssets = [...stockAssets, ...cryptoAssets];

type Clock = () => Date;

type ResolverOptions = {
  apiKey: string | undefined;
  fetchImpl?: FetchLike;
  now?: Clock;
  timeoutMs?: number;
};

type CachedIcons = {
  storedAt: number;
  icons: AssetIconMap;
};

export function createAssetIconResolver({
  apiKey,
  fetchImpl = fetch,
  now = () => new Date(),
  timeoutMs = CODEX_REQUEST_TIMEOUT_MS,
}: ResolverOptions) {
  let cache: CachedIcons | null = null;
  let inFlight: Promise<AssetIconMap> | null = null;

  return async function resolveAssetIcons(): Promise<AssetIconMap> {
    const currentTime = now().getTime();
    if (cache && currentTime - cache.storedAt <= ICON_CACHE_TTL_MS) {
      return cache.icons;
    }
    if (inFlight) return inFlight;

    inFlight = loadAssetIcons({ apiKey, fetchImpl, timeoutMs });
    try {
      const icons = await inFlight;
      cache = { storedAt: now().getTime(), icons };
      return icons;
    } finally {
      inFlight = null;
    }
  };
}

let sharedResolver: ReturnType<typeof createAssetIconResolver> | null = null;
let sharedKey: string | undefined;

export function getResolvedAssetIcons(): Promise<AssetIconMap> {
  const apiKey = process.env.CODEX_API_KEY;
  if (!sharedResolver || sharedKey !== apiKey) {
    sharedKey = apiKey;
    sharedResolver = createAssetIconResolver({ apiKey });
  }
  return sharedResolver();
}

export function clearAssetIconCacheForTests() {
  sharedResolver = null;
  sharedKey = undefined;
}

export function emptyAssetIconMap(): AssetIconMap {
  return Object.fromEntries(
    configuredIconAssets.map((asset) => [asset.id, null]),
  );
}

async function loadAssetIcons({
  apiKey,
  fetchImpl,
  timeoutMs,
}: {
  apiKey: string | undefined;
  fetchImpl: FetchLike;
  timeoutMs: number;
}): Promise<AssetIconMap> {
  const [onchain, metadata] = await Promise.all([
    readOnchainIconImages({ fetchImpl }),
    apiKey?.trim()
      ? readCodexTokenImages({
          apiKey: apiKey.trim(),
          fetchImpl,
          timeoutMs,
        }).catch(() => new Map<string, string>())
      : Promise.resolve(new Map<string, string>()),
  ]);

  const icons: AssetIconMap = {};
  for (const asset of configuredIconAssets) {
    const key = contractKey(asset.chainId, asset.contractAddress);
    icons[asset.id] = onchain.get(key) ?? metadata.get(key) ?? null;
  }
  return icons;
}
