import {
  investAssets,
  type InvestAsset,
  type InvestAssetId,
} from "@/config/invest-assets";
import type {
  MarketDataState,
  MarketSnapshot,
} from "@/features/invest/invest-market";
import {
  CODEX_CACHE_TTL_MS,
  CODEX_GRAPHQL_ENDPOINT,
  CODEX_MAX_BATCHES,
  CODEX_MAX_FUTURE_SKEW_MS,
  CODEX_MAX_TOKENS_PER_REQUEST,
  CODEX_PRICE_SOURCE_LABEL,
  CODEX_PRICE_SOURCE_URL,
  CODEX_REQUEST_TIMEOUT_MS,
  CODEX_TOKEN_PRICES_QUERY,
} from "./config";
import { parseJsonWithNumberLexemes } from "./lossless-json";
import { formatChangeLabel } from "./change-label";
import {
  MARKET_PRICE_DISPLAY_FRESHNESS_MS,
  MARKET_PRICES_VERSION,
  type MarketPricesResponse,
} from "./public-contract";

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
type Clock = () => Date;

type CodexReaderOptions = {
  apiKey: string | undefined;
  fetchImpl?: FetchLike;
  now?: Clock;
  timeoutMs?: number;
};

type CachedMarketPrices = {
  storedAt: number;
  response: MarketPricesResponse;
};

type CodexInput = {
  address: `0x${string}`;
  networkId: number;
};

type AllowedAsset = {
  id: InvestAssetId;
  category: string;
  address: `0x${string}`;
  networkId: number;
};

type ScopedRecord = {
  value: unknown;
  requestedContracts: ReadonlySet<string>;
};

export class CodexMarketDataError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CodexMarketDataError";
  }
}

export function createCodexMarketPricesReader({
  apiKey,
  fetchImpl = fetch,
  now = () => new Date(),
  timeoutMs = CODEX_REQUEST_TIMEOUT_MS,
}: CodexReaderOptions) {
  const assets = readConfiguredAssets(investAssets);
  let cache: CachedMarketPrices | null = null;
  let inFlight: Promise<MarketPricesResponse> | null = null;

  return async function readCodexMarketPrices(): Promise<MarketPricesResponse> {
    if (!apiKey?.trim()) return createUnavailableMarketPricesResponse(assets);

    const currentTime = now().getTime();
    if (cache && currentTime - cache.storedAt <= CODEX_CACHE_TTL_MS) {
      return cache.response;
    }
    if (inFlight) return inFlight;

    inFlight = fetchMarketPrices({
      apiKey: apiKey.trim(),
      assets,
      fetchImpl,
      now,
      timeoutMs,
    });

    try {
      const response = await inFlight;
      cache = { storedAt: now().getTime(), response };
      return response;
    } finally {
      inFlight = null;
    }
  };
}

export function createUnavailableMarketPricesResponse(
  assets: readonly AllowedAsset[] = readConfiguredAssets(investAssets),
): MarketPricesResponse {
  return {
    version: MARKET_PRICES_VERSION,
    provider: "codex",
    fetchedAt: null,
    unavailableReason: "not-configured",
    markets: createCategoryStates(assets, { status: "unavailable" }),
  };
}

export function createErrorMarketPricesResponse(
  message = "Current market prices are unavailable.",
): MarketPricesResponse {
  const assets = readConfiguredAssets(investAssets);
  return {
    version: MARKET_PRICES_VERSION,
    provider: "codex",
    fetchedAt: null,
    markets: createCategoryStates(assets, { status: "error", message }),
  };
}

let sharedReader: ReturnType<typeof createCodexMarketPricesReader> | null = null;
let sharedKey: string | undefined;

export function getCodexMarketPrices(): Promise<MarketPricesResponse> {
  const apiKey = process.env.CODEX_API_KEY;
  if (!sharedReader || sharedKey !== apiKey) {
    sharedKey = apiKey;
    sharedReader = createCodexMarketPricesReader({ apiKey });
  }
  return sharedReader();
}

export function clearCodexMarketPricesCacheForTests() {
  sharedReader = null;
  sharedKey = undefined;
}

async function fetchMarketPrices({
  apiKey,
  assets,
  fetchImpl,
  now,
  timeoutMs,
}: {
  apiKey: string;
  assets: readonly AllowedAsset[];
  fetchImpl: FetchLike;
  now: Clock;
  timeoutMs: number;
}): Promise<MarketPricesResponse> {
  const batches = chunkAssets(assets);
  const records: ScopedRecord[] = [];

  for (const batch of batches) {
    const payload = await executeCodexBatch({
      apiKey,
      inputs: batch.map(({ address, networkId }) => ({ address, networkId })),
      fetchImpl,
      timeoutMs,
    });
    const requestedContracts = new Set(
      batch.map(({ networkId, address }) => contractKey(networkId, address)),
    );
    records.push(
      ...readBatchRecords(payload).map((value) => ({
        value,
        requestedContracts,
      })),
    );
  }

  const fetchedAt = now();
  const snapshots = normalizeSnapshots(records, assets, fetchedAt);
  const snapshotsByCategory = new Map<string, MarketSnapshot[]>();

  for (const asset of assets) {
    if (!snapshotsByCategory.has(asset.category)) {
      snapshotsByCategory.set(asset.category, []);
    }
  }
  for (const snapshot of snapshots) {
    const asset = assets.find(({ id }) => id === snapshot.assetId);
    if (asset) snapshotsByCategory.get(asset.category)?.push(snapshot);
  }

  const markets: Record<string, MarketDataState> = {};
  for (const [category, categorySnapshots] of snapshotsByCategory) {
    markets[category] = { status: "ready", snapshots: categorySnapshots };
  }

  return {
    version: MARKET_PRICES_VERSION,
    provider: "codex",
    fetchedAt: fetchedAt.toISOString(),
    markets,
  };
}

async function executeCodexBatch({
  apiKey,
  inputs,
  fetchImpl,
  timeoutMs,
}: {
  apiKey: string;
  inputs: readonly CodexInput[];
  fetchImpl: FetchLike;
  timeoutMs: number;
}): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = new Headers({
      accept: "application/json",
      "content-type": "application/json",
    });
    headers.set(["Author", "ization"].join(""), apiKey);
    const response = await fetchImpl(CODEX_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: CODEX_TOKEN_PRICES_QUERY,
        variables: { inputs },
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new CodexMarketDataError(
        `Codex market data returned HTTP ${response.status}.`,
      );
    }

    const parsed = parseJsonWithNumberLexemes(await response.text());
    const envelope = readRecord(parsed);
    if (Array.isArray(envelope?.errors) && envelope.errors.length > 0) {
      throw new CodexMarketDataError("Codex market data returned an error.");
    }
    if (envelope?.data === null || envelope?.data === undefined) {
      throw new CodexMarketDataError("Codex market data returned no data.");
    }
    return envelope.data;
  } catch (error) {
    if (error instanceof CodexMarketDataError) throw error;
    const message = controller.signal.aborted
      ? "Codex market data timed out."
      : "Codex market data request failed.";
    throw new CodexMarketDataError(message, { cause: error });
  } finally {
    clearTimeout(timeout);
  }
}

function readBatchRecords(data: unknown): unknown[] {
  const record = readRecord(data);
  if (!record || !Array.isArray(record.getTokenPrices)) {
    throw new CodexMarketDataError(
      "Codex market data returned an invalid price list.",
    );
  }
  return record.getTokenPrices;
}

function normalizeSnapshots(
  records: readonly ScopedRecord[],
  assets: readonly AllowedAsset[],
  fetchedAt: Date,
): MarketSnapshot[] {
  const allowedByContract = new Map(
    assets.map((asset) => [contractKey(asset.networkId, asset.address), asset]),
  );
  const normalized = new Map<string, MarketSnapshot>();
  const duplicates = new Set<string>();

  for (const scopedRecord of records) {
    const record = readRecord(scopedRecord.value);
    if (!record) continue;

    const address = readAddress(record.address);
    const networkId = readInteger(record.networkId);
    if (!address || networkId === null) continue;

    const key = contractKey(networkId, address);
    const asset = allowedByContract.get(key);
    if (!asset || !scopedRecord.requestedContracts.has(key)) continue;

    const priceUsd = readPositiveDecimal(record.priceUsd);
    const timestampSeconds = readInteger(record.timestamp);
    if (!priceUsd || timestampSeconds === null) continue;

    const sourceTimeMs = timestampSeconds * 1_000;
    if (!Number.isSafeInteger(sourceTimeMs)) continue;
    if (sourceTimeMs > fetchedAt.getTime() + CODEX_MAX_FUTURE_SKEW_MS) continue;
    if (fetchedAt.getTime() - sourceTimeMs > MARKET_PRICE_DISPLAY_FRESHNESS_MS) {
      continue;
    }

    const asOf = new Date(sourceTimeMs);
    if (Number.isNaN(asOf.getTime())) continue;

    if (normalized.has(key)) {
      duplicates.add(key);
      normalized.delete(key);
      continue;
    }
    if (duplicates.has(key)) continue;

    const changeLabel = formatChangeLabel(record.priceChange24);
    normalized.set(key, {
      assetId: asset.id,
      displayPrice: `$${priceUsd}`,
      asOf: asOf.toISOString(),
      sourceLabel: CODEX_PRICE_SOURCE_LABEL,
      sourceUrl: CODEX_PRICE_SOURCE_URL,
      ...(changeLabel ? { changeLabel } : {}),
    });
  }

  return assets.flatMap((asset) => {
    const snapshot = normalized.get(contractKey(asset.networkId, asset.address));
    return snapshot ? [snapshot] : [];
  });
}

function readConfiguredAssets(
  configuredAssets: readonly InvestAsset[],
): AllowedAsset[] {
  const maximum = CODEX_MAX_TOKENS_PER_REQUEST * CODEX_MAX_BATCHES;
  if (configuredAssets.length > maximum) {
    throw new CodexMarketDataError(
      `The configured market roster exceeds the ${maximum}-asset safety bound.`,
    );
  }

  const seen = new Set<string>();
  return configuredAssets.map((asset) => {
    const key = contractKey(asset.chainId, asset.contractAddress);
    if (seen.has(key)) {
      throw new CodexMarketDataError(
        "The configured market roster contains a duplicate contract.",
      );
    }
    seen.add(key);
    return {
      id: asset.id as InvestAssetId,
      category: asset.category,
      address: asset.contractAddress,
      networkId: asset.chainId,
    };
  });
}

function chunkAssets(assets: readonly AllowedAsset[]) {
  const batches: AllowedAsset[][] = [];
  for (let index = 0; index < assets.length; index += CODEX_MAX_TOKENS_PER_REQUEST) {
    batches.push(assets.slice(index, index + CODEX_MAX_TOKENS_PER_REQUEST));
  }
  return batches;
}

function createCategoryStates(
  assets: readonly AllowedAsset[],
  state: MarketDataState,
): Record<string, MarketDataState> {
  const markets: Record<string, MarketDataState> = {};
  for (const asset of assets) markets[asset.category] = state;
  return markets;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readAddress(value: unknown): `0x${string}` | null {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    return null;
  }
  return value as `0x${string}`;
}

function readInteger(value: unknown): number | null {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function readPositiveDecimal(value: unknown): string | null {
  if (typeof value !== "string" || value !== value.trim()) return null;
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) {
    return null;
  }
  const mantissa = value.split(/[eE]/, 1)[0] ?? "";
  return /[1-9]/.test(mantissa) ? value : null;
}

function contractKey(networkId: number, address: string) {
  return `${networkId}:${address.toLowerCase()}`;
}
