import * as z from "zod/mini";
import { parseAddress } from "@/shared/chain/hex";
import {
  BASE_CHAIN_ID,
  investAssets,
} from "@/config/invest-assets";

export const MARKET_PRICE_HISTORY_VERSION = 1 as const;
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
const marketPriceHistoryPointSchema = z.object({
  time: z.string().check(z.refine((value) => Number.isFinite(Date.parse(value)))),
  value: z.string().check(
    z.regex(/^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/),
    z.refine((value) => /[1-9]/.test(value.split(/[eE]/)[0] ?? "")),
  ),
});
const unavailableReasonSchema = z.enum(["not-configured", "unknown-asset", "invalid-range", "overloaded"]);
const marketPriceHistoryResponseSchema = z.object({
  version: z.literal(MARKET_PRICE_HISTORY_VERSION),
  provider: z.literal("codex"),
  assetId: z.nullable(z.string()),
  range: z.nullable(marketPriceRangeSchema),
  currency: z._default(z.literal("USD"), "USD"),
  fetchedAt: z.pipe(z.unknown(), z.transform((value) => typeof value === "string" ? value : null)),
  status: z.enum(["ready", "empty", "unavailable", "error"]),
  points: z.readonly(z.array(marketPriceHistoryPointSchema)),
  unavailableReason: z.optional(unavailableReasonSchema),
}).check(
  z.refine((response) => response.unavailableReason === undefined || response.status === "unavailable"),
  z.refine((response) => (response.assetId !== null && response.range !== null) || (
    response.status === "unavailable" &&
    (response.unavailableReason === "unknown-asset" || response.unavailableReason === "invalid-range")
  )),
);

export type MarketPriceRange = z.output<typeof marketPriceRangeSchema>;
export type DynamicMarketPriceAssetId = z.output<typeof dynamicMarketPriceAssetIdSchema>;
export type MarketPriceAssetId = z.output<typeof marketPriceAssetIdSchema>;
export type MarketPriceAssetIdentity = z.output<typeof marketPriceAssetIdentitySchema>;
export type MarketPriceHistoryPoint = z.output<typeof marketPriceHistoryPointSchema>;
export type MarketPriceHistoryResponse = z.output<typeof marketPriceHistoryResponseSchema>;

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

export function isMarketPriceRange(value: string): value is MarketPriceRange {
  return marketPriceRangeSchema.safeParse(value).success;
}

export function parseHistoryResponse(value: unknown): MarketPriceHistoryResponse | null {
  const result = marketPriceHistoryResponseSchema.safeParse(value);
  return result.success ? result.data : null;
}
