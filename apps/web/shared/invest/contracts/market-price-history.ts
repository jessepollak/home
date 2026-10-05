import * as z from "zod/mini";
import { parseAddress } from "@/shared/chain/hex";
import {
  BASE_CHAIN_ID,
  investAssets,
} from "@/config/invest-assets";

export const MARKET_PRICE_HISTORY_VERSION = 2 as const;
export const STOCK_HISTORY_MAX_POINTS = 32;
export const TOKENIZED_EQUITY_HISTORY_SOURCE_LABEL = "Chainlink";
export const TOKENIZED_EQUITY_HISTORY_SOURCE_URL = "https://docs.chain.link/data-feeds/tokenized-equity-feeds/coinbase";
export const MARKET_HISTORY_PRIORITY_HEADER = "x-home-history-priority";
export const MARKET_PRICE_RANGES = ["1D", "1W", "1M", "3M", "1Y"] as const;

const marketPriceRangeSchema = z.enum(MARKET_PRICE_RANGES);
const dynamicMarketPriceAssetIdSchema = z.templateLiteral(["base:0x", z.string()]);
const marketPriceAssetIdSchema = z.union([
  z.enum(investAssets.map((asset) => asset.id)),
  dynamicMarketPriceAssetIdSchema,
]);
const contractAddressSchema = z.templateLiteral(["0x", z.string()]);
const marketPriceAssetIdentitySchema = z.object({
  assetId: marketPriceAssetIdSchema,
  chainId: z.literal(BASE_CHAIN_ID),
  contractAddress: contractAddressSchema,
});
const isoTimeSchema = z.string().check(z.refine((value) => Number.isFinite(Date.parse(value))));
const marketPriceHistoryPointSchema = z.object({
  time: isoTimeSchema,
  value: z.string().check(
    z.regex(/^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/),
    z.refine((value) => /[1-9]/.test(value.split(/[eE]/)[0] ?? "")),
  ),
  session: z.optional(z.enum(["open", "closed"])),
});
const codexHistorySourceSchema = z.object({
  kind: z.literal("codex"),
  chainId: z.literal(BASE_CHAIN_ID),
  contractAddress: contractAddressSchema,
});
const feedHistorySourceSchema = z.object({
  kind: z.literal("tokenized-equity-feed"),
  chainId: z.literal(BASE_CHAIN_ID),
  feedProxy: contractAddressSchema,
  label: z.literal(TOKENIZED_EQUITY_HISTORY_SOURCE_LABEL),
  url: z.literal(TOKENIZED_EQUITY_HISTORY_SOURCE_URL),
});
const marketPriceHistorySourceSchema = z.union([codexHistorySourceSchema, feedHistorySourceSchema]);
const historyGapReasonSchema = z.enum(["not-deployed", "paused", "stale", "read-failed", "incomplete"]);
const historyGapSchema = z.object({
  from: isoTimeSchema,
  to: isoTimeSchema,
  reason: historyGapReasonSchema,
}).check(z.refine((gap) => Date.parse(gap.from) <= Date.parse(gap.to)));
const historyCoverageSchema = z.object({
  sampled: z.number().check(z.refine((value) => Number.isSafeInteger(value) && value >= 0 && value <= STOCK_HISTORY_MAX_POINTS)),
  observed: z.number().check(z.refine((value) => Number.isSafeInteger(value) && value >= 0 && value <= STOCK_HISTORY_MAX_POINTS)),
  gaps: z.readonly(z.array(historyGapSchema).check(z.maxLength(STOCK_HISTORY_MAX_POINTS))),
}).check(z.refine((coverage) => coverage.observed <= coverage.sampled
  && (coverage.observed === coverage.sampled || coverage.gaps.length > 0)));
const unavailableReasonSchema = z.enum(["not-configured", "unknown-asset", "invalid-range", "overloaded"]);
const marketPriceHistoryResponseSchema = z.object({
  version: z.literal(MARKET_PRICE_HISTORY_VERSION),
  provider: z.enum(["codex", "chainlink"]),
  source: z.nullable(marketPriceHistorySourceSchema),
  assetId: z.nullable(z.string()),
  range: z.nullable(marketPriceRangeSchema),
  currency: z._default(z.literal("USD"), "USD"),
  fetchedAt: z.pipe(z.unknown(), z.transform((value) => typeof value === "string" ? value : null)),
  status: z.enum(["ready", "empty", "unavailable", "error"]),
  points: z.readonly(z.array(marketPriceHistoryPointSchema)),
  coverage: z.optional(historyCoverageSchema),
  unavailableReason: z.optional(unavailableReasonSchema),
}).check(
  z.refine((response) => response.unavailableReason === undefined || response.status === "unavailable"),
  z.refine((response) => (response.assetId !== null && response.range !== null) || (
    response.status === "unavailable" &&
    (response.unavailableReason === "unknown-asset" || response.unavailableReason === "invalid-range")
  )),
  z.refine((response) => response.points.every((point, index) => {
    const prior = response.points[index - 1];
    return !prior || Date.parse(point.time) > Date.parse(prior.time);
  })),
  z.refine((response) => response.provider === "chainlink"
    ? response.source?.kind !== "codex" && response.points.length <= STOCK_HISTORY_MAX_POINTS
      && ((response.status !== "ready" && response.status !== "empty") || response.coverage !== undefined)
      && (response.coverage === undefined || response.coverage.observed === response.points.length)
    : response.source?.kind !== "tokenized-equity-feed" && response.coverage === undefined
      && response.points.every((point) => point.session === undefined)),
  z.refine((response) => {
    if (response.assetId === null) return response.source === null;
    const expected = expectedMarketPriceHistorySource(response.assetId);
    if (response.status === "ready" || response.status === "empty") {
      return expected !== null && sameHistorySource(response.source, expected);
    }
    return response.source === null || (expected !== null && sameHistorySource(response.source, expected));
  }),
);

export type MarketPriceRange = z.output<typeof marketPriceRangeSchema>;
export type DynamicMarketPriceAssetId = z.output<typeof dynamicMarketPriceAssetIdSchema>;
export type MarketPriceAssetId = z.output<typeof marketPriceAssetIdSchema>;
export type MarketPriceAssetIdentity = z.output<typeof marketPriceAssetIdentitySchema>;
export type MarketPriceHistoryPoint = z.output<typeof marketPriceHistoryPointSchema>;
export type MarketPriceHistoryResponse = z.output<typeof marketPriceHistoryResponseSchema>;
export type MarketPriceHistorySource = z.output<typeof marketPriceHistorySourceSchema>;
export type MarketPriceHistoryCoverage = z.output<typeof historyCoverageSchema>;
export type MarketPriceHistoryGap = z.output<typeof historyGapSchema>;
export type MarketPriceHistoryGapReason = z.output<typeof historyGapReasonSchema>;

const configuredAssetById = new Map<string, MarketPriceAssetIdentity>(
  investAssets.map((asset) => [
    asset.id,
    {
      assetId: asset.id,
      chainId: asset.chainId,
      contractAddress: asset.contractAddress,
    },
  ]),
);
const configuredAssetIdsByAddress = new Map(
  investAssets.map((asset) => [asset.contractAddress.toLowerCase(), asset.id]),
);
function readDynamicMarketPriceAsset(value: string) {
  if (!value.startsWith("base:")) return null;
  const address = value.slice(5);
  if (address !== address.toLowerCase() || parseAddress(address) === null) return null;
  const assetId = dynamicMarketPriceAssetIdSchema.safeParse(value);
  const contractAddress = contractAddressSchema.safeParse(address);
  return assetId.success && contractAddress.success
    ? { assetId: assetId.data, contractAddress: contractAddress.data }
    : null;
}

export function resolveMarketPriceAssetIdentity(
  value: string,
): MarketPriceAssetIdentity | null {
  const configured = configuredAssetById.get(value);
  if (configured) return configured;

  const dynamic = readDynamicMarketPriceAsset(value);
  if (!dynamic || configuredAssetIdsByAddress.has(dynamic.contractAddress)) {
    return null;
  }

  return {
    assetId: dynamic.assetId,
    chainId: BASE_CHAIN_ID,
    contractAddress: dynamic.contractAddress,
  };
}

export function isDynamicMarketPriceAssetId(
  value: MarketPriceAssetId,
): value is DynamicMarketPriceAssetId {
  return readDynamicMarketPriceAsset(value) !== null;
}

export function matchesMarketPriceAssetIdentity(asset: {
  id: string;
  chainId: number;
  contractAddress: string;
}): boolean {
  const identity = resolveMarketPriceAssetIdentity(asset.id);
  return Boolean(
    identity &&
      identity.chainId === asset.chainId &&
      identity.contractAddress.toLowerCase() === asset.contractAddress.toLowerCase(),
  );
}

const configuredFeedByAssetId = new Map<string, `0x${string}`>(
  investAssets.flatMap((asset) => asset.category === "stock" && asset.valuation
    ? [[asset.id, asset.valuation.feedProxy] as const] : []),
);

export function expectedMarketPriceHistorySource(assetId: string): MarketPriceHistorySource | null {
  const identity = resolveMarketPriceAssetIdentity(assetId);
  if (!identity) return null;
  const feedProxy = configuredFeedByAssetId.get(identity.assetId);
  if (feedProxy) {
    return {
      kind: "tokenized-equity-feed",
      chainId: BASE_CHAIN_ID,
      feedProxy,
      label: TOKENIZED_EQUITY_HISTORY_SOURCE_LABEL,
      url: TOKENIZED_EQUITY_HISTORY_SOURCE_URL,
    };
  }
  return { kind: "codex", chainId: identity.chainId, contractAddress: identity.contractAddress };
}

function sameHistorySource(actual: MarketPriceHistorySource | null, expected: MarketPriceHistorySource) {
  if (!actual || actual.kind !== expected.kind) return false;
  if (actual.kind === "codex" && expected.kind === "codex") {
    return actual.contractAddress.toLowerCase() === expected.contractAddress.toLowerCase();
  }
  return actual.kind === "tokenized-equity-feed" && expected.kind === "tokenized-equity-feed"
    && actual.feedProxy.toLowerCase() === expected.feedProxy.toLowerCase();
}

export function isMarketPriceRange(value: string): value is MarketPriceRange {
  return marketPriceRangeSchema.safeParse(value).success;
}

export function parseHistoryResponse(value: unknown): MarketPriceHistoryResponse | null {
  const result = marketPriceHistoryResponseSchema.safeParse(value);
  return result.success ? result.data : null;
}
